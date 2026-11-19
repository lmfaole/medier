//! Steam, where the library and the hours are: `games-sync steam` adds the games of the library that the log does not
//! have yet (`STEAM_API_KEY`, from steamcommunity.com/dev/apikey, and `STEAM_ID`, the 17-digit number of the profile,
//! whose game details have to be public). The log stays the record: a game is added once, by its Steam number, with
//! the hours it had then; the owner edits the status and the hours, and a later pull never writes it again.

use anyhow::{Context, Result};
use chrono::DateTime;
use serde_json::Value;
use shared_data::shelf::{http, landing, Entry, Ledger, Session};
use shared_data::tmdb::land;

use crate::profile::{self, Reading};

const OWNED_GAMES: &str = "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/";
const STEAM_LEVEL: &str = "https://api.steampowered.com/IPlayerService/GetSteamLevel/v1/";

/// Hours to a tenth, from the minutes Steam counts.
fn hours_of(minutes: i64) -> f64 {
    (f64::from(i32::try_from(minutes).unwrap_or(i32::MAX)) / 6.0).round() / 10.0
}

/// Every game of the library is `owned` in the collection; one with hours is also a line of the log, `playing` until the
/// owner says it is done or dropped. Each is `(owned, played)`.
fn entries_in(answer: &Value) -> Vec<(Entry, Option<Entry>)> {
    answer["response"]["games"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|game| {
            let minutes = game["playtime_forever"].as_i64().unwrap_or_default();
            let owned = Entry { title: game["name"].as_str()?.trim().to_string(), status: "owned".to_string(), source: Some(format!("steam:{}", game["appid"].as_i64()?)), format: Some("steam".to_string()), ..Entry::default() };
            let last_played = game["rtime_last_played"].as_i64().filter(|at| *at > 0).and_then(|at| DateTime::from_timestamp(at, 0));
            let played = (minutes > 0).then(|| Entry {
                on_date: last_played.map(|at| at.date_naive().to_string()),
                at: last_played.map(|at| at.timestamp()),
                status: "playing".to_string(),
                amount: Some(hours_of(minutes)),
                ..owned.clone()
            });
            Some((owned, played))
        })
        .filter(|(owned, _)| !owned.title.is_empty())
        .collect()
}

pub fn run(session: &Session) -> Result<()> {
    let key = std::env::var("STEAM_API_KEY").context("STEAM_API_KEY is not set: make a key at steamcommunity.com/dev/apikey and put it in the environment of the job")?;
    let steam_id = std::env::var("STEAM_ID").context("STEAM_ID is not set: the 17-digit number of the Steam profile, whose game details must be public")?;
    let answer: Value = http("games-sync (lmfaole.party; hei@lmfaole.party)")?
        .get(OWNED_GAMES)
        .query(&[("key", key.as_str()), ("steamid", steam_id.as_str()), ("include_appinfo", "1"), ("include_played_free_games", "1"), ("format", "json")])
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .context("asking Steam for the library")?
        .json()
        .context("reading Steam's answer")?;
    land(&landing("steam")?.join("owned-games.json"), &answer)?;
    let entries = entries_in(&answer);
    anyhow::ensure!(!entries.is_empty(), "Steam answered with no games: is the profile's game details public?");
    let owned: Vec<Entry> = entries.iter().map(|(owned, _)| owned.clone()).collect();
    let played: Vec<Entry> = entries.iter().filter_map(|(_, played)| played.clone()).collect();
    let added = session.shelf.append_new_in(Ledger::Collection, &session.db, &session.collection, &owned)?;
    let started = session.shelf.append_new(&session.db, &session.log, &played)?;
    let level: Value = http("games-sync (lmfaole.party; hei@lmfaole.party)")?.get(STEAM_LEVEL).query(&[("key", key.as_str()), ("steamid", steam_id.as_str())]).send().and_then(reqwest::blocking::Response::error_for_status).context("asking Steam for the level")?.json().context("reading Steam's answer about the level")?;
    land(&landing("steam")?.join("level.json"), &level)?;
    if let Some(value) = level["response"]["player_level"].as_f64() {
        profile::save(&session.db, "steam", &profile::today(), &[Reading { key: "level", label: "Nivå", value, max: None }])?;
    }
    println!("steam: {} games in the library, {added} added to the collection, {started} to the log", entries.len());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_game_is_owned_until_it_has_hours_and_its_number_is_steams() {
        let entries = entries_in(&json!({"response": {"games": [
            {"appid": 1_145_360, "name": "Hades", "playtime_forever": 1920, "rtime_last_played": 1_700_000_000},
            {"appid": 504_230, "name": "Celeste", "playtime_forever": 0, "rtime_last_played": 0},
            {"appid": 5, "playtime_forever": 10}
        ]}}));
        assert_eq!(entries.len(), 2);
        let played = entries[0].1.as_ref().unwrap_or_else(|| panic!("a game with hours is played"));
        assert_eq!((played.status.as_str(), played.amount, played.on_date.as_deref(), played.source.as_deref()), ("playing", Some(32.0), Some("2023-11-14"), Some("steam:1145360")));
        assert_eq!((entries[0].0.status.as_str(), entries[0].0.format.as_deref()), ("owned", Some("steam")));
        assert!(entries[1].1.is_none(), "a game never started has no line in the log");
    }

    #[test]
    fn a_private_profile_gives_no_games() {
        assert!(entries_in(&json!({"response": {}})).is_empty());
    }
}
