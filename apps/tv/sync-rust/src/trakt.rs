//! The episodes watched, from the owner's public `Trakt` history (`TRAKT_USER`, and `TRAKT_CLIENT_ID`: a free app key
//! that only reads what is public). Every page is landed unchanged under `.data/raw/trakt/<date>/`, and an episode
//! the log does not have yet is appended to it (matched on the series' `TMDB` number, which `Trakt` gives, never on the
//! title); a line already in the log is never touched, and an episode it has stays as it is. Then, once signed in
//! (`shared_data::trakt`), the log's days are written back (`trakt_push.rs`).

use std::collections::HashSet;

use anyhow::Result;
use serde_json::Value;
use shared_data::trakt::{known_day, Session};
use shared_data::sqlite_client::SqliteClient;
use shared_data::watch_log::Watch;

use crate::log::LOG;


/// One play of an episode, as the history lists it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Play {
    pub id: i64,
    pub day: Option<String>,
    pub series: String,
    pub year: Option<i64>,
    pub tmdb_id: i64,
    pub season: i64,
    pub episode: i64,
}

/// The plays of a history page (`episode` entries with a `show`); an entry that lacks a part is left out.
#[must_use]
pub fn plays_in(page: &Value) -> Vec<Play> {
    page.as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            Some(Play {
                id: entry["id"].as_i64()?,
                day: known_day(entry["watched_at"].as_str()?),
                series: entry["show"]["title"].as_str()?.to_string(),
                year: entry["show"]["year"].as_i64(),
                tmdb_id: entry["show"]["ids"]["tmdb"].as_i64()?,
                season: entry["episode"]["season"].as_i64()?,
                episode: entry["episode"]["number"].as_i64()?,
            })
        })
        .collect()
}

/// The log lines the plays add: an episode the log has no line for, once, on the day of its first play (none when
/// unknown). An episode the
/// log has is left alone whatever day it is on, since `air-dates` moves days and Trakt's would then come back as rewatches.
#[must_use]
pub fn new_watches(plays: &[Play], existing: &[Watch]) -> Vec<Watch> {
    let mut have: HashSet<(i64, i64, i64)> = existing.iter().filter_map(|w| Some((w.tmdb_id?, w.season?, w.episode?))).collect();
    let mut sorted = plays.to_vec();
    sorted.sort_by(|a, b| a.day.cmp(&b.day).then(a.season.cmp(&b.season)).then(a.episode.cmp(&b.episode)));
    sorted
        .into_iter()
        .filter(|play| have.insert((play.tmdb_id, play.season, play.episode)))
        .map(|play| Watch { watched_on: play.day, title: play.series, year: play.year, season: Some(play.season), episode: Some(play.episode), tmdb_id: Some(play.tmdb_id), ..Watch::default() })
        .collect()
}

pub fn run(db: &SqliteClient, path: &std::path::Path, dry_run: bool) -> Result<()> {
    let session = Session::open("tv-sync/0.1 (+https://sky.lmfaole.party/apps/medier/tv)")?;
    let plays = plays_in(&Value::Array(session.history("episodes")?));
    let existing = LOG.read(&LOG.read_file(path)?)?;
    let added = new_watches(&plays, &existing);
    for watch in &added {
        LOG.append(path, watch)?;
    }
    let count = LOG.import(db, path)?;
    println!("trakt: {} plays, {} new lines in the log; {count} viewings in all", plays.len(), added.len());
    match &session.token {
        None => println!("trakt: not signed in (trakt-login), so nothing is written to Trakt"),
        Some(token) => {
            let (removed, added) = crate::trakt_push::push(&session.http, &session.key, token, &LOG.read(&LOG.read_file(path)?)?, &plays, dry_run)?;
            println!("trakt: {} {removed} plays removed and {added} added on Trakt", if dry_run { "would have" } else { "" });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn play(day: &str, season: i64, episode: i64) -> Play {
        Play { id: 1, day: Some(day.into()), series: "Dark".into(), year: Some(2017), tmdb_id: 70523, season, episode }
    }

    #[test]
    fn a_history_page_gives_the_plays_with_the_series_number_and_skips_an_entry_without_one() {
        let page = json!([
            {"id": 5, "watched_at": "2025-10-05T18:00:00.000Z", "episode": {"season": 1, "number": 49}, "show": {"title": "Digimon", "year": 2025, "ids": {"tmdb": 286_791}}},
            {"id": 6, "watched_at": "2025-10-05T18:00:00.000Z", "episode": {"season": 1, "number": 50}, "show": {"title": "No number", "ids": {"tmdb": null}}},
            {"id": 7, "watched_at": "1970-01-01T00:00:00.000Z", "episode": {"season": 1, "number": 51}, "show": {"title": "Digimon", "year": 2025, "ids": {"tmdb": 286_791}}}
        ]);
        assert_eq!(plays_in(&page), vec![Play { id: 5, day: Some("2025-10-05".into()), series: "Digimon".into(), year: Some(2025), tmdb_id: 286_791, season: 1, episode: 49 }, Play { id: 7, day: None, series: "Digimon".into(), year: Some(2025), tmdb_id: 286_791, season: 1, episode: 51 }]);
    }

    #[test]
    fn an_episode_the_log_has_is_not_added_again_on_any_day_and_a_new_one_once() {
        let existing = [Watch { watched_on: Some("2026-01-01".into()), title: "Dark".into(), season: Some(1), episode: Some(1), tmdb_id: Some(70523), ..Watch::default() }];
        let plays = [play("2025-10-05", 1, 1), play("2026-02-02", 1, 2), play("2026-03-03", 1, 2)];
        let added = new_watches(&plays, &existing);
        assert_eq!(added.iter().map(|w| (w.watched_on.as_deref().unwrap_or_default(), w.episode)).collect::<Vec<_>>(), vec![("2026-02-02", Some(2))]);
        assert!(new_watches(&plays, &added.iter().chain(&existing).cloned().collect::<Vec<_>>()).is_empty());
    }
}
