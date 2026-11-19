//! When the next episode of each series in the log comes out, from `TVmaze` (free, no key). TMDB has no coming episodes,
//! `TVmaze` does. A series is found by its `IMDb` number, else by its name and the year it began; the answers are landed
//! unchanged under `.data/raw/tvmaze/<date>/` and the next episode is stored in `tv_next`, fetched again each run
//! because it moves as episodes come out. A series its last answer called ended has none coming, so it is asked again
//! only once a month (a series can come back), and one whose `TVmaze` number is stored is not looked up again.

use std::time::Duration;

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use shared_data::sqlite_client::SqliteClient;
use shared_data::tmdb;

const API: &str = "https://api.tvmaze.com";
const SQL_SERIES: &str = "SELECT tv_title.tmdb_id, title, first_air_date, imdb_id, tv_next.tvmaze_id FROM tv_title LEFT JOIN tv_next USING (tmdb_id) \
    WHERE tv_title.tmdb_id IN (SELECT tmdb_id FROM tv_watch WHERE tmdb_id IS NOT NULL UNION SELECT tmdb_id FROM tv_match WHERE tmdb_id IS NOT NULL)";
/// How long the answer that a series ended is trusted before it is asked again.
const ENDED_FOR: i64 = 30 * 86_400;

/// Whether a series is asked this run: always, unless its last answer (with when it was landed) said it had ended and
/// is younger than `ENDED_FOR`.
#[must_use]
pub fn due(last_status: Option<&str>, landed_at: Option<i64>, now: i64) -> bool {
    !(last_status == Some("Ended") && landed_at.is_some_and(|at| at > now - ENDED_FOR))
}
const PAUSE: Duration = Duration::from_millis(600);
/// A server error is tried once more after this: `TVmaze` answers 502 now and then and is back a moment later.
const RETRY_AFTER: Duration = Duration::from_secs(5);

/// The next episode of a show's answer (fetched with `embed=nextepisode`): (season, episode, name, day).
#[derive(Debug, PartialEq, Eq)]
pub struct Next {
    pub season: Option<i64>,
    pub episode: Option<i64>,
    pub name: Option<String>,
    pub air_date: Option<String>,
}

#[must_use]
pub fn next_of(show: &Value) -> Option<Next> {
    let next = &show["_embedded"]["nextepisode"];
    next.is_object().then(|| Next { season: tmdb::positive(&next["season"]), episode: tmdb::positive(&next["number"]), name: tmdb::text(&next["name"]), air_date: tmdb::text(&next["airdate"]) })
}

/// Whether a search hit is the series asked for: the same name, and began in the same year when both say.
#[must_use]
pub fn is_same(show: &Value, title: &str, year: Option<i64>) -> bool {
    let name = show["name"].as_str().unwrap_or_default();
    let began = show["premiered"].as_str().and_then(tmdb::year_of);
    shared_data::text::normalize(name) == shared_data::text::normalize(title) && (year.is_none() || began.is_none() || year == began)
}

/// `TVmaze`'s answer, or `null` for a show it does not know (it answers 404 there).
fn get(http: &reqwest::blocking::Client, path: &str, query: &[(&str, &str)]) -> Result<Value> {
    let mut response = http.get(format!("{API}{path}")).query(query).send().with_context(|| format!("asking TVmaze for {path}"))?;
    std::thread::sleep(PAUSE);
    if response.status().is_server_error() {
        std::thread::sleep(RETRY_AFTER);
        response = http.get(format!("{API}{path}")).query(query).send().with_context(|| format!("asking TVmaze for {path} again"))?;
    }
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(Value::Null);
    }
    response.error_for_status().with_context(|| format!("asking TVmaze for {path}"))?.json().context("reading TVmaze's answer")
}

pub fn run(db: &SqliteClient) -> Result<()> {
    let http = shared_data::http::client("tv-sync/0.1 (+https://sky.lmfaole.party/apps/medier/tv)")?;
    let directory = shared_data::raw::landing_path("tvmaze", chrono::Utc::now().date_naive())?;
    std::fs::create_dir_all(&directory).with_context(|| format!("creating {}", directory.display()))?;
    let now = chrono::Utc::now().timestamp();
    let series = db.query(SQL_SERIES, &[])?;
    let landed = shared_data::raw::newest_landed("tvmaze")?;
    let (mut found, mut unknown, mut ended) = (0, 0, 0);
    let mut failed = Vec::new();
    for row in &series {
        let (Some(id), Some(title)) = (row["tmdb_id"].as_i64(), row["title"].as_str()) else { continue };
        let last = landed.get(&format!("tv-{id}.json"));
        let status = last.and_then(|(path, _)| std::fs::read_to_string(path).ok()).and_then(|text| serde_json::from_str::<Value>(&text).ok()).and_then(|show| show["status"].as_str().map(str::to_string));
        if !due(status.as_deref(), last.map(|(_, at)| *at), now) {
            ended += 1;
            continue;
        }
        match fetch_one(db, &http, &directory, row, id, title, now) {
            Ok(true) => found += 1,
            Ok(false) => unknown += 1,
            Err(error) => {
                eprintln!("tvmaze: {title} skipped: {error:#}");
                failed.push(title.to_string());
            }
        }
    }
    println!("tvmaze: {found} series found, {unknown} not known to TVmaze, {ended} ended and not asked again yet");
    if !failed.is_empty() {
        bail!("{} series could not be fetched and keep what they had: {}", failed.len(), failed.join(", "));
    }
    Ok(())
}

/// The `TVmaze` number of a series not looked up before: by its `IMDb` number, else by its name and start year.
fn find_show(http: &reqwest::blocking::Client, row: &Value, title: &str) -> Result<Option<i64>> {
    let year = row["first_air_date"].as_str().and_then(tmdb::year_of);
    let mut show = match row["imdb_id"].as_str() {
        Some(imdb) => get(http, "/lookup/shows", &[("imdb", imdb)])?,
        None => Value::Null,
    };
    if !show.is_object() {
        let hit = get(http, "/singlesearch/shows", &[("q", title)])?;
        show = if is_same(&hit, title, year) { hit } else { Value::Null };
    }
    Ok(show["id"].as_i64())
}

/// One series: found at `TVmaze` and its next episode stored (`true`), or not known there (`false`). An error leaves what
/// is stored as it was, and the run goes on to the next series.
fn fetch_one(db: &SqliteClient, http: &reqwest::blocking::Client, directory: &std::path::Path, row: &Value, id: i64, title: &str, now: i64) -> Result<bool> {
    let Some(show_id) = row["tvmaze_id"].as_i64().map_or_else(|| find_show(http, row, title), |known| Ok(Some(known)))? else { return Ok(false) };
    // `embed=nextepisode` answers 502 for a series that has none coming, so the link to it is followed only when there is one.
    let mut full = get(http, &format!("/shows/{show_id}"), &[])?;
    if let Some(link) = full["_links"]["nextepisode"]["href"].as_str().and_then(|href| href.strip_prefix(API)) {
        let episode = get(http, link, &[])?;
        full["_embedded"] = json!({"nextepisode": episode});
    }
    tmdb::land(&directory.join(format!("tv-{id}.json")), &full)?;
    let next = next_of(&full);
    db.execute_batch(&[
        ("DELETE FROM tv_next WHERE tmdb_id = ?".to_string(), vec![json!(id)]),
        (
            "INSERT INTO tv_next (tmdb_id, tvmaze_id, next_season, next_episode, next_name, next_air_date, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)".to_string(),
            vec![json!(id), json!(show_id), json!(next.as_ref().and_then(|n| n.season)), json!(next.as_ref().and_then(|n| n.episode)), json!(next.as_ref().and_then(|n| n.name.clone())), json!(next.as_ref().and_then(|n| n.air_date.clone())), json!(now)],
        ),
    ])
    .with_context(|| format!("storing the next episode of {title}"))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_ended_series_is_asked_again_only_a_month_after_its_last_answer() {
        let now = 100 * 86_400;
        assert!(!due(Some("Ended"), Some(now - 86_400), now));
        assert!(due(Some("Ended"), Some(now - 31 * 86_400), now), "a series can come back");
        assert!(due(Some("Running"), Some(now - 86_400), now));
        assert!(due(None, None, now), "never asked");
    }

    #[test]
    fn the_next_episode_is_what_the_show_embeds_and_none_when_nothing_is_announced() {
        let show = json!({"_embedded": {"nextepisode": {"season": 3, "number": 4, "name": "Fire", "airdate": "2026-11-01"}}});
        assert_eq!(next_of(&show), Some(Next { season: Some(3), episode: Some(4), name: Some("Fire".into()), air_date: Some("2026-11-01".into()) }));
        assert_eq!(next_of(&json!({"status": "Ended"})), None);
    }

    #[test]
    fn a_hit_is_the_series_only_with_the_same_name_and_start_year() {
        let hit = json!({"name": "Severance", "premiered": "2022-02-18"});
        assert!(is_same(&hit, "severance", Some(2022)));
        assert!(!is_same(&hit, "Severance", Some(1999)));
        assert!(!is_same(&hit, "The Bear", Some(2022)));
        assert!(is_same(&hit, "Severance", None));
    }
}
