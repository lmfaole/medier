//! `Xbox`, where the owner's console games and gamerscore are: `games-sync xbox` reads the two exports of
//! `TrueAchievements` (landed by hand under `.data/raw/trueachievements/<date>/`, `npm run land`): the
//! unlocked achievements (`…_listitems.csv`) and the game collection (`MyGameCollection_….csv`). There is no API to
//! ask. Every game is `owned` in the collection (format = its platform); one with unlocks or a completion day is also a line of the
//! log (`xbox:<title>`, the day it was completed, else the day of its last unlock) and one with hours another with the total and no
//! day (`xbox:<title>:hours`: Xbox counts the time as one total, so it is kept off the days), each added once. The
//! achievements are kept in `game_achievement` as service `xbox`, a game's list replaced whole each run. The export lists
//! only the unlocked, so the locked ones, their names and a game's total are not known (`isFromExport` in the pages). A game whose whole list `OpenXBL` has given (`xbox-api`) is left as it is.
//! Not kept: `TrueAchievements`' own scores and ratios, the site's rating, completion estimates, challenges and links.

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;

use anyhow::{Context, Result};
use chrono::{DateTime, NaiveDate, NaiveDateTime};
use shared_data::shelf::{Entry, Ledger, Session};

use crate::achievement::{save, Achievement};
use crate::profile;

const SOURCE: &str = "trueachievements";
const SERVICE: &str = "xbox";
/// The games whose list `OpenXBL` gave whole: it has rarity, which the export never does.
const WHOLE: &str = "SELECT DISTINCT game FROM game_achievement WHERE source = 'xbox' AND rarity IS NOT NULL";

/// One game of the collection export.
#[derive(Debug, Default, PartialEq)]
struct Game {
    title: String,
    platform: String,
    digital: bool,
    owned: bool,
    hours: Option<f64>,
    rating: Option<f64>,
    completed_on: Option<String>,
}

/// One unlocked achievement of the list export.
#[derive(Debug, PartialEq)]
struct Unlock {
    game: String,
    id: String,
    title: String,
    points: Option<i64>,
    at: i64,
}

fn rows_in(text: &str) -> Result<Vec<HashMap<String, String>>> {
    let mut reader = csv::ReaderBuilder::new().flexible(true).from_reader(text.trim_start_matches('\u{feff}').as_bytes());
    let headers: Vec<String> = reader.headers().context("reading the header")?.iter().map(|name| name.trim().to_string()).collect();
    reader
        .records()
        .map(|record| {
            let record = record.context("reading a line")?;
            Ok(headers.iter().cloned().zip(record.iter().map(str::to_string)).collect())
        })
        .collect()
}

fn field<'a>(row: &'a HashMap<String, String>, name: &str) -> Option<&'a str> {
    row.get(name).map(|value| value.trim()).filter(|value| !value.is_empty())
}

/// `28/10/2019 08:45:23` as `2019-10-28`.
fn day_of(text: &str) -> Option<String> {
    Some(NaiveDateTime::parse_from_str(text, "%d/%m/%Y %H:%M:%S").ok()?.date().to_string())
}

fn games_in(text: &str) -> Result<Vec<Game>> {
    Ok(rows_in(text)?
        .iter()
        .filter_map(|row| {
            Some(Game {
                title: field(row, "Game name")?.to_string(),
                platform: field(row, "Platform").unwrap_or_default().to_lowercase(),
                digital: field(row, "Format").is_some_and(|format| format.eq_ignore_ascii_case("digital")),
                owned: field(row, "Ownership Status").is_some_and(|status| status.eq_ignore_ascii_case("owned")),
                hours: field(row, "Hours Played").and_then(|hours| hours.parse().ok()).filter(|hours: &f64| *hours > 0.0),
                rating: field(row, "My Rating").and_then(|rating| rating.parse::<f64>().ok()).filter(|rating| *rating > 0.0).map(|rating| (rating * 2.0).round() / 2.0),
                completed_on: field(row, "Completion Date").and_then(day_of),
            })
        })
        .collect())
}

/// The id is the number in the achievement's address (`…/a346528/…`), else its name.
fn unlocks_in(text: &str) -> Result<Vec<Unlock>> {
    Ok(rows_in(text)?
        .iter()
        .filter_map(|row| {
            let title = field(row, "AchievementName")?.to_string();
            let id = field(row, "AchievementPageURL")
                .and_then(|address| address.split('/').find(|part| part.len() > 1 && part.starts_with('a') && part[1..].chars().all(|c| c.is_ascii_digit())))
                .map_or_else(|| title.clone(), |part| part[1..].to_string());
            Some(Unlock {
                game: field(row, "GameName")?.to_string(),
                id,
                title,
                points: field(row, "Gamerscore").and_then(|score| score.parse().ok()),
                at: DateTime::parse_from_rfc3339(field(row, "UnlockDate")?).ok()?.timestamp(),
            })
        })
        .collect())
}

fn source_of(title: &str) -> String {
    format!("{SERVICE}:{}", title.to_lowercase())
}

fn day_at(seconds: i64) -> Option<String> {
    DateTime::from_timestamp(seconds, 0).map(|at| at.date_naive().to_string())
}

/// The collection lines and the log lines: a game is owned by the export, and played when it has hours, unlocks or a
/// completion day. A game the list names but the collection does not is still played.
fn entries_in(games: &[Game], unlocks: &[Unlock]) -> (Vec<Entry>, Vec<Entry>) {
    let mut last_unlock: BTreeMap<&str, i64> = BTreeMap::new();
    for unlock in unlocks {
        let last = last_unlock.entry(unlock.game.as_str()).or_insert(unlock.at);
        *last = (*last).max(unlock.at);
    }
    let owned = games
        .iter()
        .filter(|game| game.owned)
        .map(|game| Entry {
            title: game.title.clone(),
            status: "owned".to_string(),
            source: Some(source_of(&game.title)),
            format: Some([Some(game.platform.as_str()).filter(|platform| !platform.is_empty()), game.digital.then_some("digital")].into_iter().flatten().collect::<Vec<_>>().join(",")).filter(|format| !format.is_empty()),
            ..Entry::default()
        })
        .collect();
    let mut titles: Vec<&str> = games.iter().map(|game| game.title.as_str()).collect();
    titles.extend(last_unlock.keys().copied().filter(|title| !games.iter().any(|game| game.title == *title)));
    let played = titles
        .into_iter()
        .flat_map(|title| {
            let game = games.iter().find(|game| game.title == title);
            let completed_on = game.and_then(|game| game.completed_on.clone());
            let day = completed_on.clone().or_else(|| last_unlock.get(title).copied().and_then(day_at));
            // The hours are a total with no days: on their own line with no day, they are counted but never drawn on one day.
            let hours = game.and_then(|game| game.hours).map(|hours| Entry { title: title.to_string(), status: "playing".to_string(), amount: Some(hours), source: Some(format!("{}:hours", source_of(title))), ..Entry::default() });
            let on_day = day.map(|day| Entry {
                on_date: Some(day),
                title: title.to_string(),
                status: if completed_on.is_some() { "done" } else { "playing" }.to_string(),
                rating: game.and_then(|game| game.rating),
                source: Some(source_of(title)),
                ..Entry::default()
            });
            [on_day, hours].into_iter().flatten().collect::<Vec<_>>()
        })
        .collect();
    (owned, played)
}

/// The unlocked achievements of each game, by the game's title in lowercase as its log line's source has it.
fn achievements_in(unlocks: &[Unlock]) -> BTreeMap<String, Vec<Achievement>> {
    let mut found: BTreeMap<String, Vec<Achievement>> = BTreeMap::new();
    for unlock in unlocks {
        found.entry(unlock.game.to_lowercase()).or_default().push(Achievement { id: unlock.id.clone(), title: unlock.title.clone(), points: unlock.points, unlocked_at: Some(unlock.at), ..Achievement::default() });
    }
    found
}

/// The newest landed file of `trueachievements` whose name has `part` in it (folders are named by date, so they sort).
fn newest_file(part: &str) -> Result<PathBuf> {
    // The folder of a source is the parent of any day's folder.
    let root = shared_data::raw::landing_path(SOURCE, chrono::Utc::now().date_naive())?.parent().map(PathBuf::from).unwrap_or_default();
    let mut days: Vec<PathBuf> = std::fs::read_dir(&root)
        .with_context(|| format!("reading {}: land the exports first, `npm run land -- {SOURCE} <file>`", root.display()))?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.is_dir() && path.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.parse::<NaiveDate>().is_ok()))
        .collect();
    days.sort();
    days.iter()
        .rev()
        .find_map(|day| std::fs::read_dir(day).ok()?.filter_map(|entry| entry.ok().map(|entry| entry.path())).find(|path| path.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.contains(part))))
        .with_context(|| format!("no landed file with {part:?} in its name under {}", root.display()))
}

pub fn run(session: &Session) -> Result<()> {
    let read = |part: &str| -> Result<String> {
        let file = newest_file(part)?;
        std::fs::read_to_string(&file).with_context(|| format!("reading {}", file.display()))
    };
    let games = games_in(&read("MyGameCollection")?)?;
    let unlocks = unlocks_in(&read("listitems")?)?;
    let (owned, played) = entries_in(&games, &unlocks);
    let added = session.shelf.append_new_in(Ledger::Collection, &session.db, &session.collection, &owned)?;
    let started = session.shelf.append_new(&session.db, &session.log, &played)?;
    let achievements = achievements_in(&unlocks);
    let whole: Vec<String> = session.db.query(WHOLE, &[])?.iter().filter_map(|row| row["game"].as_str().map(str::to_string)).collect();
    for (game, list) in achievements.iter().filter(|(game, _)| !whole.contains(game)) {
        save(&session.db, SERVICE, game, list)?;
    }
    profile::xbox_gamerscore(&session.db)?;
    println!("xbox: {} games, {added} added to the collection, {started} to the log, {} unlocked achievements of {} games", games.len(), unlocks.len(), achievements.len());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const COLLECTION: &str = "\" Game name\",\"Platform\",\"Achievements Won (incl. DLC)\",\"Max Achievements (incl. DLC)\",\"Completion Date\",\"Hours Played\",\"My Rating\",\"Ownership Status\",\"Format\"\n\
        \"Apex Legends\",\"Xbox One\",\"2\",\"2\",\"28/10/2019 08:45:23\",\"1354\",\"0.0\",\"Owned\",\"\"\n\
        \"Control\",\"Xbox One\",\"1\",\"4\",\"\",\"0\",\"0.0\",\"Owned\",\"Digital\"\n\
        \"Never Opened\",\"Windows\",\"0\",\"9\",\"\",\"0\",\"0.0\",\"Owned\",\"\"\n";
    const LIST: &str = "\"GameName\",\"AchievementName\",\"AchievementPageURL\",\"Gamerscore\",\"TAScore\",\"TARatio\",\"DLCName\",\"UnlockDate\",\n\
        \"Control\",\"Choose to be Chosen\",\"https://www.trueachievements.com/a279169/choose-to-be-chosen-achievement\",\"15\",\"15\",\"1\",\"\",\"2021-12-05T11:42:51.000Z\",\n\
        \"Apex Legends\",\"Decked Out\",\"https://www.trueachievements.com/a267790/decked-out-achievement\",\"75\",\"106\",\"1.41\",\"\",\"2019-10-28T08:45:23.000Z\",\n\
        \"Apex Legends\",\"The Player\",\"https://www.trueachievements.com/a267789/the-player-achievement\",\"100\",\"154\",\"1.54\",\"\",\"2019-05-05T10:27:50.000Z\",\n";

    #[test]
    fn a_game_is_owned_by_its_platform_and_played_when_it_has_hours_or_unlocks() {
        let (owned, played) = entries_in(&games_in(COLLECTION).expect("games"), &unlocks_in(LIST).expect("unlocks"));
        assert_eq!(owned.iter().map(|entry| entry.format.as_deref()).collect::<Vec<_>>(), [Some("xbox one"), Some("xbox one,digital"), Some("windows")]);
        assert_eq!(played.len(), 3);
        let apex = &played[0];
        assert_eq!((apex.status.as_str(), apex.on_date.as_deref(), apex.amount, apex.source.as_deref()), ("done", Some("2019-10-28"), None, Some("xbox:apex legends")));
        let hours = &played[1];
        assert_eq!((hours.on_date.as_deref(), hours.amount, hours.source.as_deref()), (None, Some(1354.0), Some("xbox:apex legends:hours")));
        let control = &played[2];
        assert_eq!((control.status.as_str(), control.on_date.as_deref(), control.amount), ("playing", Some("2021-12-05"), None));
    }

    #[test]
    fn the_unlocked_are_kept_with_their_score_and_day_by_game() {
        let achievements = achievements_in(&unlocks_in(LIST).expect("unlocks"));
        let control = &achievements["control"];
        assert_eq!(control.len(), 1);
        assert_eq!((control[0].id.as_str(), control[0].points, control[0].unlocked_at), ("279169", Some(15), Some(1_638_704_571)));
        assert_eq!(achievements["apex legends"].len(), 2);
    }
}
