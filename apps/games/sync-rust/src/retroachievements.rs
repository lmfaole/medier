//! `RetroAchievements`, where the games played in an emulator are counted: `games-sync retroachievements` adds the
//! games of the account that the log lacks (`ra:<game number>`, same rule as Steam: added once, never rewritten) and
//! keeps each one's achievements, and those of every ROM in `RomM` that has a `RetroAchievements` number. `RA_USER` and `RA_API_KEY` (retroachievements.org, Settings, Web API Key). Read-only:
//! an unlock is only ever sent by the emulator while the owner plays.

use std::collections::BTreeSet;
use std::time::Duration;

use anyhow::{Context, Result};
use chrono::NaiveDateTime;
use serde_json::Value;
use shared_data::shelf::{http, landing, web_address, Entry, Session};
use shared_data::tmdb::{land, text};

use crate::achievement::{save, Achievement};
use crate::profile::{self, Reading};

const API: &str = "https://retroachievements.org/API/";
const BADGES: &str = "https://media.retroachievements.org/Badge/";
const PAGE: usize = 500;
const ROM_GAMES: &str = "SELECT DISTINCT ra_id FROM game_romm WHERE ra_id IS NOT NULL";
const PAUSE: Duration = Duration::from_millis(500);

/// `RetroAchievements` writes UTC as `2023-11-14 18:22:10`.
fn seconds_of(date: &Value) -> Option<i64> {
    Some(NaiveDateTime::parse_from_str(date.as_str()?, "%Y-%m-%d %H:%M:%S").ok()?.and_utc().timestamp())
}

/// A game the account has an award in is `playing` until the owner says it is done; the console is in the title so
/// two ports of one game do not look alike.
pub fn entries_in(progress: &Value) -> Vec<Entry> {
    progress["Results"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|game| {
            let title = text(&game["Title"])?;
            let console = text(&game["ConsoleName"]);
            let awarded = seconds_of(&game["MostRecentAwardedDate"]).and_then(|at| chrono::DateTime::from_timestamp(at, 0));
            Some(Entry {
                on_date: awarded.map(|at| at.date_naive().to_string()),
                at: awarded.map(|at| at.timestamp()),
                title: console.map_or_else(|| title.clone(), |console| format!("{title} ({console})")),
                status: "playing".to_string(),
                source: Some(format!("ra:{}", game["GameID"].as_i64()?)),
                ..Entry::default()
            })
        })
        .collect()
}

/// The achievements of a game with the account's unlocks; a hardcore unlock counts when there is one. Rarity is the
/// share of the game's players who have it.
pub fn achievements_in(game: &Value) -> Vec<Achievement> {
    let players = game["NumDistinctPlayers"].as_f64().filter(|players| *players > 0.0);
    game["Achievements"]
        .as_object()
        .into_iter()
        .flat_map(|list| list.values())
        .filter_map(|achievement| {
            Some(Achievement {
                id: achievement["ID"].as_i64()?.to_string(),
                title: text(&achievement["Title"])?,
                description: text(&achievement["Description"]),
                icon: achievement["BadgeName"].as_str().and_then(|badge| web_address(&format!("{BADGES}{badge}.png"))),
                points: achievement["Points"].as_i64(),
                rarity: players.zip(achievement["NumAwarded"].as_f64()).map(|(players, awarded)| (awarded / players * 1000.0).round() / 10.0),
                unlocked_at: seconds_of(&achievement["DateEarnedHardcore"]).or_else(|| seconds_of(&achievement["DateEarned"])),
                ..Achievement::default()
            })
        })
        .collect()
}

fn ask(client: &reqwest::blocking::Client, endpoint: &str, user: &str, key: &str, extra: &[(&str, String)]) -> Result<Value> {
    let mut query = vec![("z", user.to_string()), ("y", key.to_string()), ("u", user.to_string())];
    query.extend(extra.iter().map(|(name, value)| (*name, value.clone())));
    let answer = client.get(format!("{API}{endpoint}.php")).query(&query).send().and_then(reqwest::blocking::Response::error_for_status).with_context(|| format!("asking RetroAchievements for {endpoint}"))?.json().with_context(|| format!("reading the answer of {endpoint}"))?;
    std::thread::sleep(PAUSE);
    Ok(answer)
}

pub fn run(session: &Session) -> Result<()> {
    let user = std::env::var("RA_USER").context("RA_USER is not set: the RetroAchievements user name")?;
    let key = std::env::var("RA_API_KEY").context("RA_API_KEY is not set: retroachievements.org, Settings, Web API Key")?;
    let client = http("games-sync (lmfaole.party; hei@lmfaole.party)")?;
    let directory = landing("retroachievements")?;
    let (mut results, mut offset) = (Vec::new(), 0);
    loop {
        let page = ask(&client, "API_GetUserCompletionProgress", &user, &key, &[("c", PAGE.to_string()), ("o", offset.to_string())])?;
        let found = page["Results"].as_array().map_or(0, Vec::len);
        land(&directory.join(format!("progress-{offset}.json")), &page)?;
        results.extend(page["Results"].as_array().cloned().unwrap_or_default());
        offset += found;
        if found < PAGE {
            break;
        }
    }
    let progress = serde_json::json!({ "Results": results });
    let entries = entries_in(&progress);
    let added = session.shelf.append_new(&session.db, &session.log, &entries)?;
    // The games of the account, and every ROM of RomM that RetroAchievements knows: a game not yet played has its list too, all locked.
    let mut numbers: BTreeSet<i64> = results.iter().filter_map(|game| game["GameID"].as_i64()).collect();
    numbers.extend(session.db.query(ROM_GAMES, &[])?.iter().filter_map(|row| row["ra_id"].as_str()?.parse::<i64>().ok()));
    let mut kept = 0;
    for number in numbers {
        let answer = ask(&client, "API_GetGameInfoAndUserProgress", &user, &key, &[("g", number.to_string()), ("a", "1".to_string())])?;
        land(&directory.join(format!("{number}.json")), &answer)?;
        let achievements = achievements_in(&answer);
        if !achievements.is_empty() {
            save(&session.db, "ra", &number.to_string(), &achievements)?;
            kept += 1;
        }
    }
    let summary = ask(&client, "API_GetUserSummary", &user, &key, &[("g", "0".to_string()), ("a", "0".to_string())])?;
    land(&directory.join("summary.json"), &summary)?;
    let readings: Vec<Reading> = [("points", "Poeng", &summary["TotalPoints"]), ("softcore", "Poeng (myk)", &summary["TotalSoftcorePoints"]), ("rank", "Rangering", &summary["Rank"])]
        .into_iter()
        .filter_map(|(key, label, value)| Some(Reading { key, label, value: value.as_f64().filter(|value| *value > 0.0)?, max: if key == "rank" { summary["TotalRanked"].as_f64() } else { None } }))
        .collect();
    profile::save(&session.db, "ra", &profile::today(), &readings)?;
    println!("retroachievements: {} games, {added} added to the log, achievements of {kept}", entries.len());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_game_is_ra_s_number_with_its_console_and_last_award_day() {
        let entries = entries_in(&json!({"Results": [
            {"GameID": 228, "Title": "Super Metroid", "ConsoleName": "SNES/Super Famicom", "MostRecentAwardedDate": "2023-11-14 18:22:10"},
            {"Title": "No number"}
        ]}));
        assert_eq!(entries.len(), 1);
        assert_eq!((entries[0].title.as_str(), entries[0].source.as_deref(), entries[0].on_date.as_deref()), ("Super Metroid (SNES/Super Famicom)", Some("ra:228"), Some("2023-11-14")));
    }

    #[test]
    fn an_achievement_has_points_a_badge_and_a_share_of_players() {
        let list = achievements_in(&json!({"NumDistinctPlayers": 200, "Achievements": {
            "1": {"ID": 1, "Title": "Morph", "Description": "Get it.", "Points": 5, "BadgeName": "00123", "NumAwarded": 50, "DateEarned": "2023-11-14 18:22:10"},
            "2": {"ID": 2, "Title": "Kraid", "Points": 10, "BadgeName": "00124", "NumAwarded": 10}
        }}));
        let by_id = |id: &str| list.iter().find(|a| a.id == id).expect("achievement");
        assert_eq!((by_id("1").points, by_id("1").rarity, by_id("1").unlocked_at), (Some(5), Some(25.0), Some(1_699_986_130)));
        assert_eq!((by_id("2").unlocked_at, by_id("2").icon.as_deref()), (None, Some("https://media.retroachievements.org/Badge/00124.png")));
    }
}
