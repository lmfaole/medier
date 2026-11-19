//! `games-sync apple-games`: the games in Apple's data export (landed by hand, `npm run land -- apple-media <zip>`, both
//! parts): Game Center's list of games with the day each was last played (`Game Center/Game Center Data.json`) and the
//! days an Apple Arcade game was played (`Arcade App Usage.csv` inside `Apple_Media_Services.zip`). Each game is `owned`
//! once, a game already in the collection under the same name (the Apple TV's, with its «+») is not added again, and each
//! day played is a line of the log. Friends, leaderboard scores and the account are not read.

use anyhow::{Context, Result};
use chrono::{NaiveDate, NaiveDateTime};
use serde_json::Value;
use shared_data::shelf::{Entry, Ledger, Session};

use crate::achievement::{save, Achievement};

const SOURCE: &str = "apple-media";
const GAME_CENTER: &str = "Game Center/Game Center Data.json";
const OUTER: &str = "Apple_Media_Services.zip";
const ARCADE: &str = "Arcade App Usage.csv";

/// A game's name without Apple Arcade's «+», trimmed.
fn title_of(name: &str) -> String {
    name.trim().trim_end_matches('+').trim().to_string()
}

/// What two spellings of a name share: its letters and digits, lowercased.
fn key(title: &str) -> String {
    title.chars().filter(|ch| ch.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

/// A game of Game Center: the day it was last played and the achievements the account has any progress on (the export
/// lists no locked one, so the list is partial).
#[derive(Debug, PartialEq)]
pub struct GameCenterGame {
    pub title: String,
    pub last_played: Option<NaiveDate>,
    pub achievements: Vec<Achievement>,
}

/// Game Center writes a time as `12/21/2025 03:41:59`, in UTC.
fn moment(text: &str) -> Option<NaiveDateTime> {
    NaiveDateTime::parse_from_str(text, "%m/%d/%Y %H:%M:%S").ok()
}

/// One achievement: complete at 100 %, with the time of the last update as when it was unlocked; any other value is
/// progress towards 100.
fn achievement_of(entry: &Value) -> Option<Achievement> {
    let title = entry["achievements_title"].as_str()?.trim().to_string();
    let percent = entry["percentage_complete"].as_f64()?;
    let at = entry["last_update_utc"].as_str().and_then(moment).map(|time| time.and_utc().timestamp());
    let done = percent >= 100.0;
    Some(Achievement {
        id: key(&title),
        title,
        unlocked_at: if done { at } else { None },
        progress: (!done).then_some(percent),
        target: (!done).then_some(100.0),
        ..Achievement::default()
    })
}

pub fn game_center(text: &str) -> Result<Vec<GameCenterGame>> {
    let state: Value = serde_json::from_str(text).context("reading Game Center Data.json")?;
    Ok(state["game_state"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|game| {
            let last_played = game["last_played_utc"].as_str().and_then(moment).map(|time| time.date());
            let mut achievements: Vec<Achievement> = game["achievements"].as_array().into_iter().flatten().filter_map(achievement_of).collect();
            achievements.dedup_by(|later, earlier| later.id == earlier.id);
            Some(GameCenterGame { title: title_of(game["game_name"].as_str()?), last_played, achievements })
        })
        .collect())
}

/// Each Apple Arcade game and a day it was played (`Event Date`, `20250919`).
pub fn arcade_days(text: &str) -> Result<Vec<(String, NaiveDate)>> {
    let mut reader = csv::Reader::from_reader(text.as_bytes());
    let headers = reader.headers().context("reading Arcade App Usage.csv")?.clone();
    let (Some(name), Some(date)) = (headers.iter().position(|header| header == "App Name"), headers.iter().position(|header| header == "Event Date")) else {
        return Ok(Vec::new());
    };
    Ok(reader
        .records()
        .filter_map(std::result::Result::ok)
        .filter_map(|record| Some((title_of(record.get(name)?), NaiveDate::parse_from_str(record.get(date)?, "%Y%m%d").ok()?)))
        .collect())
}

/// What goes into the collection and into the log; titles in `have` (already owned) are not added again.
pub fn entries(center: &[GameCenterGame], arcade: &[(String, NaiveDate)], have: &[String]) -> (Vec<Entry>, Vec<Entry>) {
    let mut collection: Vec<Entry> = Vec::new();
    let mut add = |title: &str, format: &str| {
        let id = key(title);
        if !id.is_empty() && !have.contains(&id) && !collection.iter().any(|entry| entry.source.as_deref() == Some(&format!("applegames:{id}"))) {
            collection.push(Entry { title: title.to_string(), status: "owned".to_string(), source: Some(format!("applegames:{id}")), format: Some(format.to_string()), ..Entry::default() });
        }
    };
    for (title, _) in arcade {
        add(title, "apple arcade");
    }
    for game in center {
        add(&game.title, "ios");
    }
    let line = |day: NaiveDate, title: &str, source: String| Entry { on_date: Some(day.to_string()), title: title.to_string(), status: "playing".to_string(), source: Some(source), ..Entry::default() };
    let mut log: Vec<Entry> = center.iter().filter_map(|game| Some(line(game.last_played?, &game.title, format!("applegc:{}", key(&game.title))))).collect();
    log.extend(arcade.iter().map(|(title, day)| line(*day, title, format!("applearcade:{}:{}", key(title), day.format("%Y%m%d")))));
    (collection, log)
}

pub fn run(session: &Session) -> Result<()> {
    let zips = shared_data::landed::zips(SOURCE)?;
    let center = zips.iter().find_map(|zip| shared_data::landed::text_in(zip, &[GAME_CENTER])).map(|text| game_center(&text)).transpose()?.unwrap_or_default();
    let arcade = zips.iter().find_map(|zip| shared_data::landed::text_in(zip, &[OUTER, ARCADE])).map(|text| arcade_days(&text)).transpose()?.unwrap_or_default();
    anyhow::ensure!(!center.is_empty() || !arcade.is_empty(), "no landed zip under the `{SOURCE}` source holds {GAME_CENTER} or {ARCADE}");
    let have: Vec<String> = if session.collection.exists() { session.shelf.read_in(Ledger::Collection, &session.shelf.read_file(&session.collection)?)?.iter().map(|entry| key(&title_of(&entry.title))).collect() } else { Vec::new() };
    let (collection, log) = entries(&center, &arcade, &have);
    for game in center.iter().filter(|game| !game.achievements.is_empty()) {
        save(&session.db, "applegc", &key(&game.title), &game.achievements)?;
    }
    let owned = session.shelf.append_new_in(Ledger::Collection, &session.db, &session.collection, &collection)?;
    let played = session.shelf.append_new_in(Ledger::Log, &session.db, &session.log, &log)?;
    let achievements: usize = center.iter().map(|game| game.achievements.len()).sum();
    println!("apple-games: {} Game Center games with {achievements} achievements, {} Arcade days; {owned} added to the collection, {played} lines added to the log", center.len(), arcade.len());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(text: &str) -> NaiveDate {
        NaiveDate::parse_from_str(text, "%Y-%m-%d").expect("a day")
    }

    #[test]
    fn game_center_gives_each_game_and_the_day_it_was_last_played() {
        let text = r#"{"game_state": [{"game_name": "Zookeeper World", "last_played_utc": "09/19/2025 04:12:48", "achievements": []}, {"game_name": "Odd", "last_played_utc": "never"}], "turn_based_games": []}"#;
        let games: Vec<_> = game_center(text).expect("games").into_iter().map(|game| (game.title, game.last_played)).collect();
        assert_eq!(games, vec![("Zookeeper World".to_string(), Some(day("2025-09-19"))), ("Odd".to_string(), None)]);
    }

    #[test]
    fn a_finished_achievement_has_the_time_it_was_unlocked_and_an_unfinished_one_its_progress() {
        let text = r#"{"game_state": [{"game_name": "holedown", "achievements": [
            {"achievements_title": "Saved by the ball", "percentage_complete": 100, "last_update_utc": "09/18/2025 03:34:51"},
            {"achievements_title": "Saved by the ball", "percentage_complete": 100, "last_update_utc": "09/18/2025 03:34:51"},
            {"achievements_title": "Deep one", "percentage_complete": 40.5, "last_update_utc": "09/18/2025 03:34:51"}]}]}"#;
        let achievements = game_center(text).expect("games").remove(0).achievements;
        assert_eq!(achievements.len(), 2, "a repeated entry is one");
        assert_eq!((achievements[0].id.as_str(), achievements[0].unlocked_at, achievements[0].progress), ("savedbytheball", Some(1_758_166_491), None));
        assert_eq!((achievements[1].unlocked_at, achievements[1].progress, achievements[1].target), (None, Some(40.5), Some(100.0)));
    }

    #[test]
    fn arcade_usage_gives_the_game_without_its_plus_and_the_day() {
        let text = "App Name,Event Date,Event Type\nBalatro+,20250919,qualifyingActivity\nBroken,notaday,x\n";
        assert_eq!(arcade_days(text).expect("days"), vec![("Balatro".to_string(), day("2025-09-19"))]);
    }

    #[test]
    fn a_game_is_owned_once_and_not_again_when_the_collection_has_its_name() {
        let game = |title: &str, last_played| GameCenterGame { title: title.to_string(), last_played, achievements: Vec::new() };
        let center = vec![game("Zookeeper World", Some(day("2025-09-19"))), game("Balatro", None)];
        let arcade = vec![("Balatro".to_string(), day("2025-09-20")), ("Balatro".to_string(), day("2025-09-21"))];
        let (collection, log) = entries(&center, &arcade, &[key("Zookeeper World")]);
        assert_eq!(collection.iter().map(|entry| (entry.title.as_str(), entry.format.as_deref())).collect::<Vec<_>>(), vec![("Balatro", Some("apple arcade"))]);
        assert_eq!(log.len(), 3, "the Game Center day of Zookeeper World and both Arcade days of Balatro");
    }
}
