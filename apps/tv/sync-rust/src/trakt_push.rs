//! The local log written to `Trakt`: the log is the record and `Trakt` a copy of it. For each episode the log has a line
//! for, the days `Trakt` holds must be the log's days; where they differ the plays `Trakt` has of that episode are removed
//! and the log's days added (Trakt cannot change a day). An episode only `Trakt` has is never touched here: the pull
//! brings it into the log first. Nothing is deleted from `Trakt` for a line removed from the log.

use std::collections::{BTreeMap, BTreeSet};

use anyhow::Result;
use serde_json::{json, Value};
use shared_data::watch_log::Watch;

use crate::trakt::Play;
use shared_data::trakt::send;

/// An episode per request: well below what Trakt takes in one, and a failed one loses little.
const BATCH: usize = 300;

type Key = (i64, i64, i64);

/// What to change on `Trakt`: the ids of plays to remove, and the (series, season, episode, day) plays to add.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Plan {
    pub remove: Vec<i64>,
    pub add: Vec<(Key, String)>,
}

#[must_use]
pub fn plan(local: &[Watch], remote: &[Play]) -> Plan {
    let mut days: BTreeMap<Key, BTreeSet<String>> = BTreeMap::new();
    for watch in local {
        if let (Some(series), Some(season), Some(episode), Some(day)) = (watch.tmdb_id, watch.season, watch.episode, &watch.watched_on) {
            days.entry((series, season, episode)).or_default().insert(day.clone());
        }
    }
    let mut held: BTreeMap<Key, Vec<&Play>> = BTreeMap::new();
    for play in remote {
        held.entry((play.tmdb_id, play.season, play.episode)).or_default().push(play);
    }
    let mut plan = Plan::default();
    for (key, wanted) in days {
        let plays = held.remove(&key).unwrap_or_default();
        // A day held twice is a duplicate: the plays are replaced just as when a day is wrong.
        if plays.len() == wanted.len() && plays.iter().filter_map(|play| play.day.clone()).collect::<BTreeSet<_>>() == wanted {
            continue;
        }
        plan.remove.extend(plays.iter().map(|play| play.id));
        plan.add.extend(wanted.into_iter().map(|day| (key, day)));
    }
    plan
}

/// The request body adding plays: a show with its seasons and the episodes of each, every one with its day.
#[must_use]
pub fn history_body(adds: &[(Key, String)]) -> Value {
    let mut shows: BTreeMap<i64, BTreeMap<i64, Vec<Value>>> = BTreeMap::new();
    for ((series, season, episode), day) in adds {
        shows.entry(*series).or_default().entry(*season).or_default().push(json!({"number": episode, "watched_at": format!("{day}T12:00:00.000Z")}));
    }
    let shows: Vec<Value> = shows.into_iter().map(|(series, seasons)| json!({"ids": {"tmdb": series}, "seasons": seasons.into_iter().map(|(number, episodes)| json!({"number": number, "episodes": episodes})).collect::<Vec<_>>()})).collect();
    json!({"shows": shows})
}

/// Makes `Trakt` hold the log's days; with `dry_run` only says what it would do. Returns (removed, added).
pub fn push(http: &reqwest::blocking::Client, key: &str, token: &str, local: &[Watch], remote: &[Play], dry_run: bool) -> Result<(usize, usize)> {
    let plan = plan(local, remote);
    if dry_run {
        return Ok((plan.remove.len(), plan.add.len()));
    }
    for chunk in plan.remove.chunks(BATCH) {
        send(http, key, token, "/sync/history/remove", &json!({"ids": chunk}))?;
    }
    let mut not_found = 0;
    for chunk in plan.add.chunks(BATCH) {
        let answer = send(http, key, token, "/sync/history", &history_body(chunk))?;
        not_found += answer["not_found"]["episodes"].as_array().map_or(0, Vec::len) + answer["not_found"]["shows"].as_array().map_or(0, Vec::len);
    }
    if not_found > 0 {
        eprintln!("trakt: {not_found} episodes or series Trakt did not know");
    }
    Ok((plan.remove.len(), plan.add.len()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn watch(day: &str, season: i64, episode: i64) -> Watch {
        Watch { watched_on: Some(day.into()), title: "Dark".into(), season: Some(season), episode: Some(episode), tmdb_id: Some(7), ..Watch::default() }
    }

    fn play(id: i64, day: &str, season: i64, episode: i64) -> Play {
        Play { id, day: Some(day.into()), series: "Dark".into(), year: None, tmdb_id: 7, season, episode }
    }

    #[test]
    fn what_trakt_has_right_is_left_alone_a_missing_day_is_added_and_a_wrong_one_is_replaced() {
        let local = [watch("2026-01-01", 1, 1), watch("2026-01-02", 1, 2), watch("2026-01-03", 1, 3)];
        let remote = [play(10, "2026-01-01", 1, 1), play(11, "2025-05-05", 1, 2), play(12, "2026-09-09", 2, 1)];
        let plan = plan(&local, &remote);
        assert_eq!(plan.remove, vec![11]);
        assert_eq!(plan.add, vec![((7, 1, 2), "2026-01-02".to_string()), ((7, 1, 3), "2026-01-03".to_string())]);
        assert!(super::plan(&local, &[play(10, "2026-01-01", 1, 1), play(11, "2026-01-02", 1, 2), play(13, "2026-01-03", 1, 3)]).add.is_empty());
    }

    #[test]
    fn a_play_held_twice_is_replaced_by_one() {
        let local = [watch("2026-01-01", 1, 1)];
        let plan = plan(&local, &[play(10, "2026-01-01", 1, 1), play(11, "2026-01-01", 1, 1)]);
        assert_eq!(plan.remove, vec![10, 11]);
        assert_eq!(plan.add, vec![((7, 1, 1), "2026-01-01".to_string())]);
    }

    #[test]
    fn a_line_without_a_day_or_a_series_number_is_not_sent() {
        let mut undated = watch("2026-01-01", 1, 1);
        undated.watched_on = None;
        let mut unmatched = watch("2026-01-01", 1, 2);
        unmatched.tmdb_id = None;
        assert_eq!(plan(&[undated, unmatched], &[]), Plan::default());
    }

    #[test]
    fn plays_are_sent_by_series_and_season_with_their_day() {
        let body = history_body(&[((7, 1, 1), "2026-01-01".into()), ((7, 1, 2), "2026-01-02".into()), ((7, 2, 1), "2026-02-01".into())]);
        assert_eq!(body["shows"][0]["ids"]["tmdb"], 7);
        assert_eq!(body["shows"][0]["seasons"][0]["episodes"][1], json!({"number": 2, "watched_at": "2026-01-02T12:00:00.000Z"}));
        assert_eq!(body["shows"][0]["seasons"][1]["number"], 2);
    }
}
