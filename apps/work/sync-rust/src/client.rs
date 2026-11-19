//! The requests to GitHub: the token, the pacing and the waiting, the paging. What an answer
//! means is `github.rs`'s business; this file only gets the text.

use std::process::Command;
use std::thread::sleep;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use reqwest::blocking::Response;
use serde_json::json;

use crate::github::{collect_pages, parse_calendar, parse_repos, parse_search, parse_user, Day, Item, Kind, Repo, User, PER_PAGE};

/// No wait is longer than this: a strange header must not hang a run for hours.
const MAX_WAIT: Duration = Duration::from_secs(90);
const ATTEMPTS: u32 = 4;
/// Search is limited to thirty requests a minute; one every 2.2 s stays under it.
const SEARCH_PACE: Duration = Duration::from_millis(2200);
const API: &str = "https://api.github.com";

const USER_ID_QUERY: &str = "query($login: String!) { user(login: $login) { id } }";
const LATEST_COMMIT_QUERY: &str = "query($owner: String!, $name: String!, $user: ID!) { repository(owner: $owner, name: $name) { isPrivate defaultBranchRef { target { ... on Commit { history(author: {id: $user}, first: 1) { totalCount nodes { oid committedDate messageHeadline url } } } } } } }";

const CALENDAR_QUERY: &str = "query($from: DateTime!, $to: DateTime!) { viewer { contributionsCollection(from: $from, to: $to) { contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } } } } }";

/// The headers that say whether GitHub is asking to slow down.
pub struct Limit<'a> {
    pub remaining: Option<&'a str>,
    pub reset: Option<&'a str>,
    pub retry_after: Option<&'a str>,
}

/// How long to wait before asking again, or `None` when waiting would not help: a 403 with requests to spare
/// is a token without the scope, and a repeat would only be refused again.
pub fn wait_before_retry(status: u16, limit: &Limit<'_>, now: i64) -> Option<Duration> {
    if status != 403 && status != 429 {
        return None;
    }
    if let Some(seconds) = limit.retry_after.and_then(|text| text.parse::<u64>().ok()) {
        return Some(Duration::from_secs(seconds).min(MAX_WAIT));
    }
    if limit.remaining == Some("0") {
        let reset: i64 = limit.reset.and_then(|text| text.parse().ok())?;
        // One second past the reset: the reset is the instant the window opens, and asking on it can be a hair early.
        return Some(Duration::from_secs((reset - now + 1).max(1).unsigned_abs()).min(MAX_WAIT));
    }
    None
}

pub fn token_from_output(output: &str) -> Option<String> {
    let token = output.trim();
    (!token.is_empty()).then(|| token.to_string())
}

/// `GITHUB_TOKEN`, else what `gh auth token` prints: the machine's `gh` is already signed in.
fn token() -> Result<String> {
    if let Some(token) = std::env::var("GITHUB_TOKEN").ok().and_then(|value| token_from_output(&value)) {
        return Ok(token);
    }
    let output = Command::new("gh").args(["auth", "token"]).output().context("GITHUB_TOKEN is not set and `gh` could not be run")?;
    token_from_output(&String::from_utf8_lossy(&output.stdout)).context("GITHUB_TOKEN is not set and `gh auth token` gave nothing")
}

pub struct Client {
    http: reqwest::blocking::Client,
    token: String,
}

fn text_of(response: Response) -> Result<String> {
    response.text().map_err(reqwest::Error::without_url).context("reading the GitHub answer")
}

impl Client {
    pub fn new() -> Result<Self> {
        let http = reqwest::blocking::Client::builder()
            .user_agent("work-sync/0.1 (+https://jobb.lmfaole.party)")
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(60))
            .build()
            .context("building the HTTP client")?;
        Ok(Self { http, token: token()? })
    }

    /// Sends a request built by `build`, waiting out a rate limit and retrying a server error. The token is
    /// in the headers only: no URL, message or error here ever holds it.
    fn send(&self, build: impl Fn() -> reqwest::blocking::RequestBuilder) -> Result<String> {
        for attempt in 1..=ATTEMPTS {
            let response = build()
                .bearer_auth(&self.token)
                .header("Accept", "application/vnd.github+json")
                .header("X-GitHub-Api-Version", "2022-11-28")
                .send()
                .map_err(reqwest::Error::without_url)
                .context("asking GitHub")?;
            let status = response.status().as_u16();
            if status < 300 {
                return text_of(response);
            }
            let header = |name: &str| response.headers().get(name).and_then(|value| value.to_str().ok()).map(str::to_string);
            let (remaining, reset, retry_after) = (header("x-ratelimit-remaining"), header("x-ratelimit-reset"), header("retry-after"));
            let now = chrono::Utc::now().timestamp();
            let limit = Limit { remaining: remaining.as_deref(), reset: reset.as_deref(), retry_after: retry_after.as_deref() };
            if let Some(wait) = wait_before_retry(status, &limit, now).filter(|_| attempt < ATTEMPTS) {
                sleep(wait);
            } else if status >= 500 && attempt < ATTEMPTS {
                sleep(Duration::from_secs(2 * u64::from(attempt)));
            } else {
                let body = text_of(response).unwrap_or_default();
                bail!("GitHub answered {status}: {}", body.chars().take(200).collect::<String>());
            }
        }
        bail!("GitHub kept asking to wait")
    }

    fn get(&self, url: &str) -> Result<String> {
        self.send(|| self.http.get(url))
    }

    pub fn user(&self) -> Result<User> {
        parse_user(&self.get(&format!("{API}/user"))?)
    }

    pub fn repos(&self) -> Result<Vec<Repo>> {
        collect_pages(PER_PAGE, |page| {
            parse_repos(&self.get(&format!("{API}/user/repos?per_page={PER_PAGE}&page={page}&affiliation=owner,collaborator,organization_member&sort=created"))?)
        })
    }

    /// Every pull request or issue the owner opened in `year`; a search GitHub cut short is an error, not a smaller list.
    pub fn items(&self, login: &str, kind: Kind, year: i32) -> Result<Vec<Item>> {
        let query = crate::github::search_query(login, kind, year);
        collect_pages(PER_PAGE, |page| {
            sleep(SEARCH_PACE);
            let url = format!("{API}/search/issues?per_page={PER_PAGE}&page={page}&q={}", query.replace(' ', "+"));
            let found = parse_search(&self.get(&url)?, kind)?;
            if found.incomplete {
                bail!("GitHub's search for {query} was incomplete");
            }
            Ok(found.items)
        })
    }

    /// The owner's latest commit on a repository's default branch, as GitHub's GraphQL answers it. The REST
    /// list of commits misses some of an old history; this finds them. The answer says whether the
    /// repository is private, and the caller refuses one that is.
    pub fn latest_commit(&self, owner: &str, name: &str, login: &str) -> Result<String> {
        let user = self.send(|| self.http.post(format!("{API}/graphql")).json(&json!({ "query": USER_ID_QUERY, "variables": { "login": login } })))?;
        let id = crate::commits::parse_user_id(&user)?;
        let body = json!({ "query": LATEST_COMMIT_QUERY, "variables": { "owner": owner, "name": name, "user": id } });
        self.send(|| self.http.post(format!("{API}/graphql")).json(&body))
    }

    pub fn calendar(&self, year: i32) -> Result<Vec<Day>> {
        let body = json!({ "query": CALENDAR_QUERY, "variables": { "from": format!("{year}-01-01T00:00:00Z"), "to": format!("{year}-12-31T23:59:59Z") } });
        parse_calendar(&self.send(|| self.http.post(format!("{API}/graphql")).json(&body))?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_403_with_no_requests_left_waits_until_the_limit_resets() {
        let wait = wait_before_retry(403, &Limit { remaining: Some("0"), reset: Some("1060"), retry_after: None }, 1_000);

        assert_eq!(wait, Some(Duration::from_secs(61)));
    }

    #[test]
    fn retry_after_is_obeyed_for_a_429_and_a_403_alike() {
        assert_eq!(wait_before_retry(429, &Limit { remaining: None, reset: None, retry_after: Some("10") }, 0), Some(Duration::from_secs(10)));
        assert_eq!(wait_before_retry(403, &Limit { remaining: Some("4000"), reset: None, retry_after: Some("5") }, 0), Some(Duration::from_secs(5)));
    }

    #[test]
    fn a_forbidden_that_is_not_a_rate_limit_is_not_waited_out() {
        // A token without the scope gets a 403 with requests to spare; waiting would only repeat it.
        assert_eq!(wait_before_retry(403, &Limit { remaining: Some("4999"), reset: Some("9999"), retry_after: None }, 0), None);
        assert_eq!(wait_before_retry(404, &Limit { remaining: None, reset: None, retry_after: None }, 0), None);
        assert_eq!(wait_before_retry(200, &Limit { remaining: Some("0"), reset: Some("9999"), retry_after: None }, 0), None);
    }

    #[test]
    fn no_wait_is_longer_than_a_minute_and_a_half_so_a_bad_header_cannot_hang_a_run() {
        assert_eq!(wait_before_retry(403, &Limit { remaining: Some("0"), reset: Some("999999"), retry_after: None }, 0), Some(MAX_WAIT));
        assert_eq!(wait_before_retry(429, &Limit { remaining: None, reset: None, retry_after: Some("86400") }, 0), Some(MAX_WAIT));
    }

    #[test]
    fn a_reset_already_past_is_a_short_pause_not_a_negative_wait() {
        assert_eq!(wait_before_retry(403, &Limit { remaining: Some("0"), reset: Some("900"), retry_after: None }, 1_000), Some(Duration::from_secs(1)));
    }

    #[test]
    fn the_token_from_gh_is_the_text_without_its_newline_and_an_empty_one_is_no_token() {
        assert_eq!(token_from_output("ghp_abc123\n").as_deref(), Some("ghp_abc123"));
        assert_eq!(token_from_output("  \n"), None);
    }
}
