//! `Trakt`, shared by the watch-log apps: the owner's sign-in, needed to write to the history, and the two calls every
//! app makes (a page of the history, a write). The app's Client ID is enough: an app that signs in with PKCE has no
//! secret, and one that has a secret passes it in `TRAKT_CLIENT_SECRET`. The device flow: `trakt-login` asks for a code,
//! the owner types it at trakt.tv/activate and approves once, and the tokens are kept in a file only the owner can
//! read (`TRAKT_TOKEN_FILE`, else `~/.config/trakt.json`). A token lasts three months and is renewed with the
//! refresh token whenever it is within a day of running out.

use std::path::PathBuf;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};

/// The page size asked for. Trakt caps it at 250 when signed in, and at 250 it answered an empty page 3 of 4 once, so a page is
/// kept small; `History` still checks that what it read is as many as Trakt says there are.
const PAGE_SIZE: &str = "100";
pub const API: &str = "https://api.trakt.tv";
/// The `watched_at` `Trakt` gives a play whose day is not known, and takes back as the same.
pub const UNKNOWN_WATCHED_AT: &str = "1970-01-01T00:00:00.000Z";

/// The day of a `watched_at`, or none for the unknown day: a log keeps an unknown day as no day, never as 1970.
#[must_use]
pub fn known_day(watched_at: &str) -> Option<String> {
    watched_at.get(..10).filter(|day| *day != &UNKNOWN_WATCHED_AT[..10]).map(str::to_string)
}

pub fn token_path() -> PathBuf {
    std::env::var_os("TRAKT_TOKEN_FILE").map_or_else(|| PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".config/trakt.json"), PathBuf::from)
}

fn client_id() -> Result<String> {
    std::env::var("TRAKT_CLIENT_ID").context("TRAKT_CLIENT_ID is not set (the app's Client ID from trakt.tv/oauth/applications)")
}

/// The client secret, left out for an app that signs in with PKCE and so has none.
fn with_secret(mut body: Value) -> Value {
    if let (Some(object), Ok(secret)) = (body.as_object_mut(), std::env::var("TRAKT_CLIENT_SECRET")) {
        object.insert("client_secret".into(), json!(secret));
    }
    body
}

fn post(http: &reqwest::blocking::Client, path: &str, body: &Value) -> Result<reqwest::blocking::Response> {
    http.post(format!("{API}{path}")).json(body).send().with_context(|| format!("asking Trakt for {path}"))
}

/// The token answer as the file keeps it: when it runs out is a time, not a number of seconds.
#[must_use]
pub fn kept(answer: &Value, now: i64) -> Value {
    json!({"access_token": answer["access_token"], "refresh_token": answer["refresh_token"], "expires_at": now + answer["expires_in"].as_i64().unwrap_or(0)})
}

/// Whether a kept token is within a day of running out (or cannot be read).
#[must_use]
pub fn needs_renewal(kept: &Value, now: i64) -> bool {
    kept["expires_at"].as_i64().is_none_or(|at| at - now < 86_400)
}

fn save(path: &std::path::Path, token: &Value) -> Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(path).with_context(|| format!("opening {}", path.display()))?;
    file.write_all(serde_json::to_string_pretty(token)?.as_bytes()).with_context(|| format!("writing {}", path.display()))
}

/// `trakt-login`: shows the code to approve and waits for the approval.
pub fn login() -> Result<()> {
    let id = client_id()?;
    let http = crate::http::client("watch-sync/0.1")?;
    let code: Value = post(&http, "/oauth/device/code", &json!({"client_id": id}))?.error_for_status().context("asking Trakt for a code")?.json().context("reading Trakt's answer")?;
    println!("Open {} and enter the code {}", code["verification_url"].as_str().unwrap_or("https://trakt.tv/activate"), code["user_code"].as_str().unwrap_or("?"));
    let interval = code["interval"].as_u64().unwrap_or(5);
    let waits = code["expires_in"].as_u64().unwrap_or(600) / interval.max(1);
    for _ in 0..waits {
        std::thread::sleep(Duration::from_secs(interval));
        let answer = post(&http, "/oauth/device/token", &with_secret(json!({"code": code["device_code"], "client_id": id})))?;
        match answer.status().as_u16() {
            200 => {
                save(&token_path(), &kept(&answer.json::<Value>().context("reading Trakt's token")?, chrono::Utc::now().timestamp()))?;
                println!("signed in; the token is in {}", token_path().display());
                return Ok(());
            }
            400 => {}
            429 => std::thread::sleep(Duration::from_secs(interval)),
            other => bail!("Trakt answered {other} while waiting for the approval"),
        }
    }
    bail!("the code ran out before it was approved: run trakt-login again")
}

/// The access token to write with, renewed first when it is about to run out; `None` when nobody has signed in.
pub fn access_token(http: &reqwest::blocking::Client) -> Result<Option<String>> {
    let path = token_path();
    let Ok(text) = std::fs::read_to_string(&path) else { return Ok(None) };
    let mut token: Value = serde_json::from_str(&text).with_context(|| format!("reading {}", path.display()))?;
    let now = chrono::Utc::now().timestamp();
    if needs_renewal(&token, now) {
        let body = with_secret(json!({"refresh_token": token["refresh_token"], "client_id": client_id()?, "grant_type": "refresh_token", "redirect_uri": "urn:ietf:wg:oauth:2.0:oob"}));
        let answer: Value = post(http, "/oauth/token", &body)?.error_for_status().context("renewing the Trakt token: run trakt-login again")?.json().context("reading Trakt's token")?;
        token = kept(&answer, now);
        save(&path, &token)?;
    }
    Ok(token["access_token"].as_str().map(str::to_string))
}

/// The HTTP client every Trakt call goes through; `agent` names the app.
pub fn client(agent: &str) -> Result<reqwest::blocking::Client> {
    crate::http::client(agent)
}

/// One page of the history of `kind` (`episodes` or `movies`), how many pages there are and how many entries in all. Signed in,
/// it is read from the account's own list, which Trakt does not cache; the public list is cached for about twenty
/// minutes, and a write read back from it would look as if it had not happened.
pub fn history_page(http: &reqwest::blocking::Client, key: &str, user: &str, token: Option<&str>, kind: &str, page: i64) -> Result<(Value, i64, usize)> {
    let path = if token.is_some() { format!("/sync/history/{kind}") } else { format!("/users/{user}/history/{kind}") };
    let request = http.get(format!("{API}{path}")).query(&[("limit", PAGE_SIZE), ("page", page.to_string().as_str())]).header("trakt-api-version", "2").header("trakt-api-key", key);
    let response = match token {
        Some(token) => request.bearer_auth(token),
        None => request,
    }
    .send()
    .and_then(reqwest::blocking::Response::error_for_status)
    .with_context(|| format!("asking Trakt for the history of {user}"))?;
    let header = |name: &str| response.headers().get(name).and_then(|value| value.to_str().ok()).and_then(|value| value.parse::<usize>().ok());
    let (pages, items) = (header("x-pagination-page-count").unwrap_or(1), header("x-pagination-item-count"));
    std::thread::sleep(Duration::from_millis(500));
    let page: Value = response.json().context("reading Trakt's answer")?;
    let items = items.unwrap_or_else(|| page.as_array().map_or(0, Vec::len));
    Ok((page, i64::try_from(pages).unwrap_or(1), items))
}

/// A write to Trakt, paused after it to stay inside its limit of one write a second.
pub fn send(http: &reqwest::blocking::Client, key: &str, token: &str, path: &str, body: &Value) -> Result<Value> {
    let answer = http
        .post(format!("{API}{path}"))
        .header("trakt-api-version", "2")
        .header("trakt-api-key", key)
        .bearer_auth(token)
        .json(body)
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .with_context(|| format!("writing to Trakt at {path}"))?
        .json()
        .context("reading Trakt's answer")?;
    std::thread::sleep(Duration::from_millis(1100));
    Ok(answer)
}

/// One run against Trakt: the app's key, whose history is read, the HTTP client, where the pages are landed and the sign-in
/// when there is one.
pub struct Session {
    pub key: String,
    pub http: reqwest::blocking::Client,
    pub token: Option<String>,
    user: String,
    directory: PathBuf,
}

impl Session {
    /// Opens a run for the app named by `agent`; `TRAKT_CLIENT_ID` and `TRAKT_USER` come from the environment.
    pub fn open(agent: &str) -> Result<Self> {
        let key = client_id()?;
        let user = std::env::var("TRAKT_USER").context("TRAKT_USER is not set: the Trakt user name whose history is read")?;
        let http = client(agent)?;
        let directory = crate::raw::landing_path("trakt", chrono::Utc::now().date_naive())?;
        std::fs::create_dir_all(&directory).with_context(|| format!("creating {}", directory.display()))?;
        let token = access_token(&http)?;
        Ok(Self { key, http, token, user, directory })
    }

    /// Every entry of the history of `kind` (`episodes` or `movies`), page by page, each page landed unchanged. Fails unless
    /// as many entries were read as Trakt says there are, so nothing is written on the strength of half a history.
    pub fn history(&self, kind: &str) -> Result<Vec<Value>> {
        let mut entries = Vec::new();
        let (mut page, mut pages, mut total) = (1, 1, 0);
        while page <= pages {
            let (answer, count, items) = history_page(&self.http, &self.key, &self.user, self.token.as_deref(), kind, page)?;
            pages = count;
            total = items;
            crate::tmdb::land(&self.directory.join(format!("history-{kind}-{page}.json")), &answer)?;
            entries.extend(answer.as_array().cloned().unwrap_or_default());
            page += 1;
        }
        if entries.len() < total {
            bail!("read {} of the {total} plays Trakt says there are: nothing is written until all are read", entries.len());
        }
        Ok(entries)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_token_is_renewed_a_day_before_it_runs_out_and_never_before() {
        let token = kept(&json!({"access_token": "a", "refresh_token": "r", "expires_in": 7_776_000}), 1_000);
        assert_eq!(token["expires_at"], 7_777_000);
        assert!(!needs_renewal(&token, 1_000));
        assert!(needs_renewal(&token, 7_777_000 - 3_600));
        assert!(needs_renewal(&json!({}), 0));
    }
}
