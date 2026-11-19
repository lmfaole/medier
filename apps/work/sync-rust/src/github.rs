//! What GitHub says about the owner: the account, the repositories, the pull requests and issues
//! opened, and the contribution calendar. This file parses the answers and builds the requests; it
//! never touches the network (`client.rs` does), so every shape is tested against a fixture.

use anyhow::{bail, Context, Result};
use serde::Deserialize;

/// GitHub's search gives at most this many rows for one query, however many pages are asked for.
pub const SEARCH_CEILING: usize = 1000;
pub const PER_PAGE: usize = 100;

#[derive(Debug, PartialEq, Eq)]
pub struct User {
    pub login: String,
    pub created_year: i32,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Repo {
    pub full_name: String,
    pub private: bool,
    pub fork: bool,
    pub archived: bool,
    pub created_at: String,
    pub pushed_at: Option<String>,
    pub language: Option<String>,
    pub stars: i64,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Pr,
    Issue,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Pr => "pr",
            Kind::Issue => "issue",
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct Item {
    pub id: i64,
    pub kind: Kind,
    pub repo: String,
    pub number: i64,
    pub title: String,
    pub state: String,
    pub merged: bool,
    pub created_at: String,
    pub closed_at: Option<String>,
    pub url: String,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Day {
    pub day: String,
    pub contributions: i64,
}

#[derive(Debug, PartialEq, Eq)]
pub struct SearchPage {
    pub items: Vec<Item>,
    /// GitHub's search gave up part of the way: what came is not all there is.
    pub incomplete: bool,
}

#[derive(Deserialize)]
struct UserAnswer {
    login: String,
    created_at: String,
}

pub fn parse_user(json: &str) -> Result<User> {
    let answer: UserAnswer = serde_json::from_str(json).context("reading the GitHub user")?;
    let created_year = answer.created_at.get(..4).and_then(|year| year.parse().ok()).context("reading the year the account began")?;
    Ok(User { login: answer.login, created_year })
}

#[derive(Deserialize)]
struct RepoAnswer {
    full_name: String,
    private: bool,
    fork: bool,
    archived: bool,
    created_at: String,
    pushed_at: Option<String>,
    language: Option<String>,
    #[serde(default)]
    stargazers_count: i64,
    description: Option<String>,
}

pub fn parse_repos(json: &str) -> Result<Vec<Repo>> {
    let answers: Vec<RepoAnswer> = serde_json::from_str(json).context("reading a page of repositories")?;
    Ok(answers
        .into_iter()
        .map(|repo| Repo {
            full_name: repo.full_name,
            private: repo.private,
            fork: repo.fork,
            archived: repo.archived,
            created_at: repo.created_at,
            pushed_at: repo.pushed_at,
            language: repo.language,
            stars: repo.stargazers_count,
            description: repo.description,
        })
        .collect())
}

#[derive(Deserialize)]
struct SearchAnswer {
    #[serde(default)]
    incomplete_results: bool,
    items: Vec<ItemAnswer>,
}

#[derive(Deserialize)]
struct ItemAnswer {
    id: i64,
    number: i64,
    title: String,
    state: String,
    created_at: String,
    closed_at: Option<String>,
    html_url: String,
    repository_url: String,
    pull_request: Option<PullRequestAnswer>,
}

#[derive(Deserialize)]
struct PullRequestAnswer {
    merged_at: Option<String>,
}

pub fn parse_search(json: &str, kind: Kind) -> Result<SearchPage> {
    let answer: SearchAnswer = serde_json::from_str(json).context("reading a page of search results")?;
    let mut items = Vec::new();
    for item in answer.items {
        let repo = item.repository_url.strip_prefix("https://api.github.com/repos/").with_context(|| format!("{} is not a repository address", item.repository_url))?.to_string();
        items.push(Item {
            id: item.id,
            kind,
            repo,
            number: item.number,
            title: item.title,
            state: item.state,
            merged: item.pull_request.is_some_and(|pull| pull.merged_at.is_some()),
            created_at: item.created_at,
            closed_at: item.closed_at,
            url: item.html_url,
        });
    }
    Ok(SearchPage { items, incomplete: answer.incomplete_results })
}

pub fn parse_calendar(json: &str) -> Result<Vec<Day>> {
    let value: serde_json::Value = serde_json::from_str(json).context("reading the contribution calendar")?;
    if let Some(errors) = value.get("errors") {
        let message = errors.get(0).and_then(|error| error.get("message")).and_then(|message| message.as_str()).unwrap_or("an error");
        bail!("GitHub's GraphQL answered: {message}");
    }
    let weeks = value
        .pointer("/data/viewer/contributionsCollection/contributionCalendar/weeks")
        .and_then(|weeks| weeks.as_array())
        .context("the answer has no contribution calendar")?;
    let mut days = Vec::new();
    for day in weeks.iter().filter_map(|week| week.get("contributionDays")).filter_map(|days| days.as_array()).flatten() {
        let contributions = day.get("contributionCount").and_then(serde_json::Value::as_i64).context("a day has no count")?;
        if contributions > 0 {
            days.push(Day { day: day.get("date").and_then(|date| date.as_str()).context("a day has no date")?.to_string(), contributions });
        }
    }
    Ok(days)
}

/// The search for what the owner opened of one kind in one calendar year: a year at a time keeps every
/// query well under the ceiling of a thousand rows.
pub fn search_query(login: &str, kind: Kind, year: i32) -> String {
    format!("author:{login} type:{} created:{year}-01-01..{year}-12-31", kind.as_str())
}

pub fn years(first: i32, last: i32) -> Vec<i32> {
    (first..=last).collect()
}

/// Pages 1, 2, 3 … of `per_page` rows each, until one comes back short. A search that would run past
/// GitHub's ceiling is an error: what it gave would be a silent half.
pub fn collect_pages<T>(per_page: usize, mut get: impl FnMut(usize) -> Result<Vec<T>>) -> Result<Vec<T>> {
    let mut all = Vec::new();
    let mut page = 1;
    loop {
        let rows = get(page)?;
        let full = rows.len() == per_page;
        all.extend(rows);
        if !full {
            return Ok(all);
        }
        if all.len() >= SEARCH_CEILING {
            bail!("{} rows and still full pages: past what GitHub's search gives", all.len());
        }
        page += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_user_reads_the_login_and_the_year_the_account_began() {
        let user = parse_user(&json!({ "login": "lmfaole", "created_at": "2018-03-30T18:56:30Z", "public_repos": 1 }).to_string()).unwrap();

        assert_eq!(user, User { login: "lmfaole".into(), created_year: 2018 });
    }

    #[test]
    fn parse_repos_reads_the_flags_and_tolerates_missing_fields() {
        let page = json!([
            { "full_name": "lmfaole/monorepo", "private": true, "fork": false, "archived": false, "created_at": "2025-01-01T00:00:00Z", "pushed_at": "2026-10-14T10:00:00Z", "language": "TypeScript", "stargazers_count": 3, "description": "the repo" },
            { "full_name": "lmfaole/old", "private": false, "fork": true, "archived": true, "created_at": "2019-02-03T00:00:00Z", "pushed_at": null, "language": null, "stargazers_count": 0, "description": null }
        ]);

        let repos = parse_repos(&page.to_string()).unwrap();

        assert_eq!(repos.len(), 2);
        assert_eq!((repos[0].full_name.as_str(), repos[0].private, repos[0].stars, repos[0].language.as_deref()), ("lmfaole/monorepo", true, 3, Some("TypeScript")));
        assert_eq!((repos[1].fork, repos[1].archived, repos[1].pushed_at.clone(), repos[1].description.clone()), (true, true, None, None));
    }

    fn search(items: serde_json::Value, incomplete: bool) -> String {
        json!({ "total_count": 1, "incomplete_results": incomplete, "items": items }).to_string()
    }

    #[test]
    fn a_pull_request_is_merged_when_it_has_a_merge_time() {
        let items = json!([
            { "id": 11, "number": 7, "title": "Add a thing", "state": "closed", "created_at": "2025-05-01T10:00:00Z", "closed_at": "2025-05-02T10:00:00Z",
              "html_url": "https://github.com/lmfaole/monorepo/pull/7", "repository_url": "https://api.github.com/repos/lmfaole/monorepo",
              "pull_request": { "merged_at": "2025-05-02T10:00:00Z" } },
            { "id": 12, "number": 8, "title": "Abandoned", "state": "closed", "created_at": "2025-05-03T10:00:00Z", "closed_at": "2025-05-04T10:00:00Z",
              "html_url": "https://github.com/lmfaole/monorepo/pull/8", "repository_url": "https://api.github.com/repos/lmfaole/monorepo",
              "pull_request": { "merged_at": null } }
        ]);

        let page = parse_search(&search(items, false), Kind::Pr).unwrap();

        assert_eq!(page.items.iter().map(|item| item.merged).collect::<Vec<_>>(), vec![true, false]);
        assert_eq!((page.items[0].repo.as_str(), page.items[0].number, page.items[0].kind), ("lmfaole/monorepo", 7, Kind::Pr));
    }

    #[test]
    fn an_issue_is_never_merged() {
        let items = json!([{ "id": 21, "number": 3, "title": "A bug", "state": "open", "created_at": "2025-06-01T10:00:00Z", "closed_at": null,
            "html_url": "https://github.com/lmfaole/monorepo/issues/3", "repository_url": "https://api.github.com/repos/lmfaole/monorepo" }]);

        let page = parse_search(&search(items, false), Kind::Issue).unwrap();

        assert_eq!((page.items[0].merged, page.items[0].closed_at.clone(), page.items[0].state.as_str()), (false, None, "open"));
    }

    #[test]
    fn an_incomplete_search_is_said_so_and_a_malformed_repository_url_is_an_error() {
        assert!(parse_search(&search(json!([]), true), Kind::Pr).unwrap().incomplete);
        let bad = json!([{ "id": 1, "number": 1, "title": "t", "state": "open", "created_at": "2025-01-01T00:00:00Z", "closed_at": null, "html_url": "u", "repository_url": "https://example.test/nothing" }]);
        assert!(parse_search(&search(bad, false), Kind::Issue).is_err());
    }

    #[test]
    fn the_calendar_keeps_the_days_with_contributions_and_drops_the_empty_ones() {
        let answer = json!({ "data": { "viewer": { "contributionsCollection": { "contributionCalendar": { "totalContributions": 5, "weeks": [
            { "contributionDays": [{ "date": "2024-01-01", "contributionCount": 0 }, { "date": "2024-01-02", "contributionCount": 3 }] },
            { "contributionDays": [{ "date": "2024-01-08", "contributionCount": 2 }] }
        ] } } } } });

        let days = parse_calendar(&answer.to_string()).unwrap();

        assert_eq!(days, vec![Day { day: "2024-01-02".into(), contributions: 3 }, Day { day: "2024-01-08".into(), contributions: 2 }]);
    }

    #[test]
    fn a_graphql_error_is_an_error_not_an_empty_calendar() {
        let answer = json!({ "errors": [{ "message": "Bad credentials" }] });

        assert!(parse_calendar(&answer.to_string()).unwrap_err().to_string().contains("Bad credentials"));
    }

    #[test]
    fn the_search_is_for_one_kind_in_one_year_of_what_the_owner_opened() {
        assert_eq!(search_query("lmfaole", Kind::Pr, 2025), "author:lmfaole type:pr created:2025-01-01..2025-12-31");
        assert_eq!(search_query("lmfaole", Kind::Issue, 2019), "author:lmfaole type:issue created:2019-01-01..2019-12-31");
    }

    #[test]
    fn years_run_from_the_first_to_the_last_inclusive() {
        assert_eq!(years(2024, 2026), vec![2024, 2025, 2026]);
        assert_eq!(years(2026, 2026), vec![2026]);
        assert!(years(2027, 2026).is_empty());
    }

    #[test]
    fn collect_pages_stops_at_the_first_short_page() {
        let mut asked = Vec::new();

        let all = collect_pages(3, |page| {
            asked.push(page);
            Ok(match page { 1 | 2 => vec![page; 3], _ => vec![9] })
        })
        .unwrap();

        assert_eq!(asked, vec![1, 2, 3]);
        assert_eq!(all, vec![1, 1, 1, 2, 2, 2, 9]);
    }

    #[test]
    fn collect_pages_stops_at_an_empty_page_and_at_the_ceiling() {
        assert_eq!(collect_pages(3, |_| Ok(Vec::<u32>::new())).unwrap(), Vec::<u32>::new());
        // GitHub's search never gives past 1 000 rows; a loop that never sees a short page must still end.
        assert!(collect_pages(1, |_| Ok(vec![1])).is_err());
    }
}
