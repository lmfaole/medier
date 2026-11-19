//! Steam's achievements for each game of the library that has hours: what the profile has unlocked
//! (`GetPlayerAchievements`), the icons (`GetSchemaForGame`) and how rare each is
//! (`GetGlobalAchievementPercentagesForApp`, which needs no key). Read-only: Steam lets only a game's publisher write.
//! Same keys as `steam`; the profile's game details have to be public.
//!
//! An achievement is unlocked only by playing, so a game is asked again only when it was played after its last landed
//! answer (Steam's `rtime_last_played`, kept as `game_entry.at`), or when that answer is a month old, for the rarity.

use std::time::Duration;

use anyhow::{Context, Result};
use serde_json::Value;
use shared_data::shelf::{http, landing, web_address, Session};
use shared_data::tmdb::{land, text};

use crate::achievement::{save, Achievement};

const PLAYER: &str = "https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/";
const SCHEMA: &str = "https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/";
const GLOBAL: &str = "https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/";
const GAMES: &str = "SELECT substr(source, 7) AS appid, MAX(at) AS last_played FROM game_entry WHERE source LIKE 'steam:%' AND amount > 0 \
    GROUP BY appid ORDER BY CAST(appid AS INTEGER)";
/// The rarity of an achievement drifts as others play, so even an unplayed game is asked again after this long.
const REFRESH_AFTER: i64 = 30 * 86_400;
/// Kind to Steam's servers: three calls a game.
const PAUSE: Duration = Duration::from_millis(500);

fn icon_of(schema: &Value, name: &str) -> Option<String> {
    schema["game"]["availableGameStats"]["achievements"].as_array()?.iter().find(|a| a["name"] == name).and_then(|a| a["icon"].as_str()).and_then(web_address)
}

/// Steam writes a percentage as a number or as a string, by version.
fn rarity_of(global: &Value, name: &str) -> Option<f64> {
    let found = global["achievementpercentages"]["achievements"].as_array()?.iter().find(|a| a["name"] == name)?;
    found["percent"].as_f64().or_else(|| found["percent"].as_str()?.parse().ok())
}

/// The player's list, with icons and rarity from the other two answers. A game with no achievements answers with
/// `success: false` or without the list, and gives none.
pub fn achievements_in(player: &Value, schema: &Value, global: &Value) -> Vec<Achievement> {
    player["playerstats"]["achievements"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|achievement| {
            let id = achievement["apiname"].as_str()?;
            Some(Achievement {
                id: id.to_string(),
                title: text(&achievement["name"]).unwrap_or_else(|| id.to_string()),
                description: text(&achievement["description"]),
                icon: icon_of(schema, id),
                points: None,
                rarity: rarity_of(global, id),
                unlocked_at: (achievement["achieved"] == 1).then(|| achievement["unlocktime"].as_i64()).flatten().filter(|at| *at > 0),
                ..Achievement::default()
            })
        })
        .collect()
}

fn ask(client: &reqwest::blocking::Client, address: &str, query: &[(&str, &str)]) -> Result<Option<Value>> {
    let response = client.get(address).query(query).send().with_context(|| format!("asking {address}"))?;
    std::thread::sleep(PAUSE);
    // A game without stats answers 400: not an error of the run.
    if response.status() == reqwest::StatusCode::BAD_REQUEST || response.status() == reqwest::StatusCode::FORBIDDEN {
        return Ok(None);
    }
    Ok(Some(response.error_for_status().with_context(|| format!("asking {address}"))?.json().with_context(|| format!("reading the answer of {address}"))?))
}

/// Whether a game is asked again: never asked, played since its last answer, or that answer older than `REFRESH_AFTER`.
#[must_use]
pub fn due(last_played: Option<i64>, fetched_at: Option<i64>, now: i64) -> bool {
    fetched_at.is_none_or(|fetched_at| last_played.is_some_and(|played| played > fetched_at) || fetched_at < now - REFRESH_AFTER)
}

pub fn run(session: &Session) -> Result<()> {
    let key = std::env::var("STEAM_API_KEY").context("STEAM_API_KEY is not set: make a key at steamcommunity.com/dev/apikey")?;
    let steam_id = std::env::var("STEAM_ID").context("STEAM_ID is not set: the 17-digit number of the Steam profile")?;
    let client = http("games-sync (lmfaole.party; hei@lmfaole.party)")?;
    let directory = landing("steam-achievements")?;
    let landed = shared_data::raw::newest_landed("steam-achievements")?;
    let now = shared_data::shelf::now();
    let (mut with, mut without, mut unplayed) = (0, 0, 0);
    for row in session.db.query(GAMES, &[])? {
        let Some(appid) = row["appid"].as_str() else { continue };
        if !due(row["last_played"].as_i64(), landed.get(&format!("{appid}-player.json")).map(|(_, at)| *at), now) {
            unplayed += 1;
            continue;
        }
        let Some(player) = ask(&client, PLAYER, &[("key", &key), ("steamid", &steam_id), ("appid", appid), ("l", "english")])? else {
            without += 1;
            continue;
        };
        let schema = ask(&client, SCHEMA, &[("key", &key), ("appid", appid), ("l", "english")])?.unwrap_or(Value::Null);
        let global = ask(&client, GLOBAL, &[("gameid", appid)])?.unwrap_or(Value::Null);
        for (name, answer) in [("player", &player), ("schema", &schema), ("global", &global)] {
            land(&directory.join(format!("{appid}-{name}.json")), answer)?;
        }
        let achievements = achievements_in(&player, &schema, &global);
        if achievements.is_empty() {
            without += 1;
        } else {
            save(&session.db, "steam", appid, &achievements)?;
            with += 1;
        }
    }
    println!("steam-achievements: {with} games with achievements, {without} without, {unplayed} not played since they were last asked");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn an_achievement_has_its_icon_and_rarity_and_is_locked_until_it_has_a_time() {
        let player = json!({"playerstats": {"achievements": [
            {"apiname": "ACH_1", "achieved": 1, "unlocktime": 1_700_000_000, "name": "First", "description": "Begin."},
            {"apiname": "ACH_2", "achieved": 0, "unlocktime": 0, "name": "Second"}
        ]}});
        let schema = json!({"game": {"availableGameStats": {"achievements": [{"name": "ACH_1", "icon": "https://cdn.steamstatic.com/a.jpg"}]}}});
        let global = json!({"achievementpercentages": {"achievements": [{"name": "ACH_1", "percent": 61.5}, {"name": "ACH_2", "percent": "3.2"}]}});
        let list = achievements_in(&player, &schema, &global);
        assert_eq!((list[0].unlocked_at, list[0].icon.as_deref(), list[0].rarity), (Some(1_700_000_000), Some("https://cdn.steamstatic.com/a.jpg"), Some(61.5)));
        assert_eq!((list[1].unlocked_at, list[1].icon.clone(), list[1].rarity), (None, None, Some(3.2)));
    }

    #[test]
    fn a_game_is_asked_again_only_when_played_since_or_its_answer_is_a_month_old() {
        let now = 100 * 86_400;
        assert!(due(None, None, now), "never asked");
        assert!(due(Some(now - 3_600), Some(now - 86_400), now), "played after the last answer");
        assert!(!due(Some(now - 2 * 86_400), Some(now - 86_400), now), "not played since");
        assert!(!due(None, Some(now - 86_400), now));
        assert!(due(None, Some(now - 31 * 86_400), now), "an answer a month old, for the rarity");
    }

    #[test]
    fn a_game_without_achievements_gives_none() {
        assert!(achievements_in(&json!({"playerstats": {"success": false}}), &Value::Null, &Value::Null).is_empty());
    }
}
