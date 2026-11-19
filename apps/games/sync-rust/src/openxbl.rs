//! Xbox's own achievements, asked from `OpenXBL` (`xbl.io`, a key in `OPENXBL_API_KEY`: `games-sync xbox-api`). For every
//! title with an unlocked achievement the whole list comes, locked ones too, with each one's description, gamerscore,
//! rarity and unlock time, so a game has a total. A title is matched to the lines `games-sync xbox` made from the
//! `TrueAchievements` exports by its name (without ™, ® and punctuation); one that has no line yet is added, with
//! the day it was last played. A game's list is replaced whole. The answers are landed under `.data/raw/openxbl/<date>/`.
//! The free key allows 150 calls an hour: one for the titles and one or two for each game. Every answer says how many are
//! left (`x-ratelimit-remaining`); a run stops cleanly at `RESERVE`, with what it has saved, and is run again later.

use std::collections::HashMap;
use std::cell::Cell;
use std::time::Duration;

use anyhow::{Context, Result};
use chrono::DateTime;
use serde_json::Value;
use shared_data::shelf::{http, landing, Entry, Ledger, Session};
use shared_data::tmdb::{land, text};

use crate::achievement::{save, Achievement};
use crate::profile;

const API: &str = "https://xbl.io/api/v2";
const SERVICE: &str = "xbox";
const GAMES: &str = "SELECT source FROM game_entry WHERE source LIKE 'xbox:%' GROUP BY source";
/// Kind to the service: its limit is generous, but a run should not be a burst.
const PAUSE: Duration = Duration::from_millis(300);
/// Calls left in the hour when a run stops, so a call by hand (or the next game's second list) still has room.
const RESERVE: i64 = 5;
/// The names the two sides spell differently, as `(OpenXBL's, the exports')`, both normalised.
const ALIASES: [(&str, &str); 2] = [("partypakke 3 fra jackbox", "the jackbox party pack 3"), ("minecraft for windows", "minecraft windows")];

/// A name as both sides can agree on it: lowercase letters and digits, one space between words.
fn normal(title: &str) -> String {
    let words = title.chars().map(|c| if c.is_alphanumeric() { c.to_lowercase().collect::<String>() } else if c == '™' || c == '®' || c == '\'' || c == '’' { String::new() } else { " ".to_string() }).collect::<String>();
    let words = words.split_whitespace().collect::<Vec<_>>().join(" ");
    ALIASES.iter().find(|(openxbl, _)| *openxbl == words).map_or(words, |(_, export)| (*export).to_string())
}

/// What the player's list says about one achievement: the modern answer (`progressState`) and the one for Xbox 360
/// games (`unlocked`, `gamerscore`) have different fields.
fn achievement_in(item: &Value) -> Option<Achievement> {
    let id = item["id"].as_str().map(str::to_string).or_else(|| item["id"].as_i64().map(|id| id.to_string()))?;
    let at = |value: &Value| DateTime::parse_from_rfc3339(value.as_str()?).ok().map(|at| at.timestamp()).filter(|at| *at > 0);
    let points = item["rewards"].as_array().and_then(|rewards| rewards.iter().find(|reward| reward["type"] == "Gamerscore")).and_then(|reward| reward["value"].as_str()?.parse().ok()).or_else(|| item["gamerscore"].as_i64());
    let unlocked = item["progressState"] == "Achieved" || item["unlocked"] == true;
    let description = text(&item["description"]).or_else(|| text(&item["lockedDescription"]));
    Some(Achievement {
        id,
        title: text(&item["name"])?,
        description,
        icon: item["mediaAssets"].as_array().and_then(|assets| assets.iter().find(|asset| asset["type"] == "Icon")).and_then(|asset| asset["url"].as_str()).and_then(shared_data::shelf::web_address),
        points,
        rarity: item["rarity"]["currentPercentage"].as_f64(),
        unlocked_at: if unlocked { at(&item["progression"]["timeUnlocked"]).or_else(|| at(&item["timeUnlocked"])) } else { None },
        ..Achievement::default()
    })
}

/// Xbox 360 games answer with unlocked achievements only; without a total the list stays a partial one, and a rarity
/// would pass it for a whole one, so it is dropped (`isFromExport` in the pages).
fn without_rarity(mut list: Vec<Achievement>) -> Vec<Achievement> {
    for achievement in &mut list {
        achievement.rarity = None;
    }
    list
}

/// The hour's calls are spent: `OpenXBL` answered 429, or said none are left.
#[derive(Debug)]
struct LimitReached;

impl std::fmt::Display for LimitReached {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "OpenXBL's limit of calls in the hour is reached")
    }
}

impl std::error::Error for LimitReached {}

/// The client, the key, and how many calls the last answer said are left (none before the first).
struct Xbl {
    client: reqwest::blocking::Client,
    key: String,
    remaining: Cell<Option<i64>>,
}

impl Xbl {
    fn ask(&self, path: &str, query: &[(&str, &str)]) -> Result<Value> {
        let address = format!("{API}/{path}");
        let response = self.client.get(&address).query(query).header("X-Authorization", &self.key).header("Accept", "application/json").send().with_context(|| format!("asking {address}"))?;
        std::thread::sleep(PAUSE);
        if let Some(left) = response.headers().get("x-ratelimit-remaining").and_then(|value| value.to_str().ok()).and_then(|value| value.parse().ok()) {
            self.remaining.set(Some(left));
        }
        if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
            self.remaining.set(Some(0));
            return Err(LimitReached.into());
        }
        response.error_for_status().with_context(|| format!("asking {address}"))?.json().with_context(|| format!("reading the answer of {address}"))
    }

    /// Whether another game's calls fit before the reserve.
    fn has_room(&self) -> bool {
        self.remaining.get().is_none_or(|left| left > RESERVE)
    }

    /// A title's whole list, following the continuation token.
    fn list_of(&self, path: &str, answers: &mut Vec<Value>) -> Result<Vec<Achievement>> {
        let mut token = String::new();
        let mut list = Vec::new();
        loop {
            let query: Vec<(&str, &str)> = if token.is_empty() { vec![] } else { vec![("continuationToken", token.as_str())] };
            let answer = self.ask(path, &query)?;
            list.extend(answer["content"]["achievements"].as_array().into_iter().flatten().filter_map(achievement_in));
            token = answer["content"]["pagingInfo"]["continuationToken"].as_str().unwrap_or_default().to_string();
            answers.push(answer);
            if token.is_empty() {
                return Ok(list);
            }
        }
    }
}

/// A title the account has played, as `OpenXBL` names it.
struct Title {
    id: String,
    name: String,
    played_on: Option<String>,
    played_at: Option<i64>,
}

fn titles_in(answer: &Value) -> Vec<Title> {
    answer["content"]["titles"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|title| title["achievement"]["currentAchievements"].as_i64().unwrap_or(0) > 0)
        .filter_map(|title| {
            Some(Title {
                id: title["titleId"].as_str()?.to_string(),
                name: text(&title["name"])?,
                played_on: title["titleHistory"]["lastTimePlayed"].as_str().and_then(|at| at.get(..10)).map(str::to_string),
                played_at: title["titleHistory"]["lastTimePlayed"].as_str().and_then(|at| chrono::DateTime::parse_from_rfc3339(at).ok()).map(|at| at.timestamp()),
            })
        })
        .collect()
}

/// The title without ™ and ®, as a line of the log writes it.
fn clean(name: &str) -> String {
    name.replace(['™', '®'], "").trim().to_string()
}

pub fn run(session: &Session) -> Result<()> {
    let key = std::env::var("OPENXBL_API_KEY").context("OPENXBL_API_KEY is not set: make a key at xbl.io/dashboard/keys")?;
    let xbl = Xbl { client: http("games-sync (lmfaole.party; hei@lmfaole.party)")?, key, remaining: Cell::new(None) };
    let directory = landing("openxbl")?;
    let overview = xbl.ask("achievements", &[])?;
    land(&directory.join("titles.json"), &overview)?;
    let xuid = overview["content"]["xuid"].as_str().context("OpenXBL gave no xuid for the account")?.to_string();
    let titles = titles_in(&overview);

    let known: HashMap<String, String> = session
        .db
        .query(GAMES, &[])?
        .iter()
        .filter_map(|row| row["source"].as_str().map(str::to_string))
        .filter_map(|source| Some((normal(source.strip_prefix("xbox:")?), source)))
        .collect();
    let (mut added, mut kept, mut left) = (Vec::new(), 0, 0);
    for title in &titles {
        if !xbl.has_room() {
            left += 1;
            continue;
        }
        let mut answers = Vec::new();
        let fetched = xbl.list_of(&format!("achievements/player/{xuid}/{}", title.id), &mut answers).and_then(|list| {
            if list.is_empty() {
                Ok(without_rarity(xbl.list_of(&format!("achievements/x360/{xuid}/title/{}", title.id), &mut answers)?))
            } else {
                Ok(list)
            }
        });
        let list = match fetched {
            Ok(list) => list,
            Err(error) if error.downcast_ref::<LimitReached>().is_some() => {
                left += 1;
                continue;
            }
            Err(error) => return Err(error),
        };
        land(&directory.join(format!("{}.json", title.id)), &Value::Array(answers))?;
        let source = known.get(&normal(&title.name)).cloned().unwrap_or_else(|| {
            let source = format!("{SERVICE}:{}", clean(&title.name).to_lowercase());
            added.push(Entry { on_date: title.played_on.clone(), at: title.played_at, title: clean(&title.name), status: "playing".to_string(), source: Some(source.clone()), ..Entry::default() });
            source
        });
        if !list.is_empty() {
            save(&session.db, SERVICE, source.strip_prefix("xbox:").unwrap_or(&source), &list)?;
            kept += 1;
        }
    }
    let owned: Vec<Entry> = added.iter().map(|line| Entry { on_date: None, status: "owned".to_string(), format: Some("xbox".to_string()), ..line.clone() }).collect();
    let collected = session.shelf.append_new_in(Ledger::Collection, &session.db, &session.collection, &owned)?;
    let started = session.shelf.append_new(&session.db, &session.log, &added)?;
    profile::xbox_gamerscore(&session.db)?;
    println!("xbox-api: {} titles, {kept} with a list, {collected} added to the collection, {started} to the log, {} calls left this hour", titles.len(), xbl.remaining.get().map_or_else(|| "?".to_string(), |left| left.to_string()));
    if left > 0 {
        println!("xbox-api: stopped at the limit with {left} titles left: run it again in an hour");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_name_is_matched_without_marks_and_with_the_two_spellings_that_differ() {
        assert_eq!(normal("STAR WARS™ Battlefront™ II"), normal("Star Wars Battlefront II"));
        assert_eq!(normal("Assassin's Creed IV Black Flag"), normal("Assassin's Creed IV: Black Flag"));
        assert_eq!(normal("Partypakke 3 fra Jackbox"), normal("The Jackbox Party Pack 3"));
        assert_eq!(normal("Minecraft for Windows"), normal("Minecraft (Windows)"));
    }

    #[test]
    fn an_achievement_has_its_gamerscore_rarity_and_is_locked_until_it_has_a_time() {
        let won = achievement_in(&json!({"id": "1", "name": "A", "progressState": "Achieved", "description": "Do it.", "progression": {"timeUnlocked": "2021-12-05T11:42:51.0000000Z"},
            "rewards": [{"type": "Gamerscore", "value": "15"}], "rarity": {"currentPercentage": 31.6}, "mediaAssets": [{"type": "Icon", "url": "https://images-eds-ssl.xboxlive.com/a"}]})).expect("achievement");
        assert_eq!((won.unlocked_at, won.points, won.rarity, won.icon.as_deref()), (Some(1_638_704_571), Some(15), Some(31.6), Some("https://images-eds-ssl.xboxlive.com/a")));
        let locked = achievement_in(&json!({"id": "2", "name": "B", "progressState": "NotStarted", "lockedDescription": "Secret.", "progression": {"timeUnlocked": "0001-01-01T00:00:00.0000000Z"}})).expect("achievement");
        assert_eq!((locked.unlocked_at, locked.description.as_deref()), (None, Some("Secret.")));
    }

    #[test]
    fn an_xbox_360_achievement_has_its_own_field_names() {
        let item = achievement_in(&json!({"id": 13, "name": "Mayo", "unlocked": true, "gamerscore": 20, "timeUnlocked": "2020-09-24T16:16:57.9930000Z"})).expect("achievement");
        assert_eq!((item.id.as_str(), item.points, item.unlocked_at), ("13", Some(20), Some(1_600_964_217)));
    }

    #[test]
    fn a_run_stops_before_the_reserve_and_starts_when_nothing_is_known() {
        let xbl = |remaining| Xbl { client: reqwest::blocking::Client::new(), key: String::new(), remaining: Cell::new(remaining) };
        assert!(xbl(None).has_room());
        assert!(xbl(Some(RESERVE + 1)).has_room());
        assert!(!xbl(Some(RESERVE)).has_room());
    }

    #[test]
    fn only_a_title_with_an_unlock_is_kept() {
        let titles = titles_in(&json!({"content": {"titles": [
            {"titleId": "1", "name": "Played", "achievement": {"currentAchievements": 3}, "titleHistory": {"lastTimePlayed": "2022-01-09T16:15:49.9751867Z"}},
            {"titleId": "2", "name": "Opened", "achievement": {"currentAchievements": 0}}]}}));
        assert_eq!(titles.iter().map(|t| (t.name.as_str(), t.played_on.as_deref(), t.played_at)).collect::<Vec<_>>(), [("Played", Some("2022-01-09"), Some(1_641_744_949))]);
    }
}
