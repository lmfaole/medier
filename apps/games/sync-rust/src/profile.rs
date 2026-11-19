//! Where the player stands at a service as a number (a level, a score, a rank), kept once for each day it was read, so
//! how it grew can be told: `game_profile` has one row for each (service, key, day), and the newest day is now.

use anyhow::{Context, Result};
use serde_json::json;
use shared_data::sqlite_client::SqliteClient;

/// One number of a profile: what it is, what the page calls it, its value and the most it can be, where there is one.
#[derive(Debug, Clone, PartialEq)]
pub struct Reading {
    pub key: &'static str,
    pub label: &'static str,
    pub value: f64,
    pub max: Option<f64>,
}

/// Today, as the owner's clock has it: the day a reading belongs to.
#[must_use]
pub fn today() -> String {
    chrono::Local::now().date_naive().to_string()
}

/// Writes the readings of `source` for `day`; a second reading the same day replaces the first.
pub fn save(db: &SqliteClient, source: &str, day: &str, readings: &[Reading]) -> Result<()> {
    let batch: Vec<(String, Vec<serde_json::Value>)> = readings
        .iter()
        .map(|reading| ("INSERT OR REPLACE INTO game_profile (source, key, day, label, value, max) VALUES (?, ?, ?, ?, ?, ?)".to_string(), vec![json!(source), json!(reading.key), json!(day), json!(reading.label), json!(reading.value), json!(reading.max)]))
        .collect();
    db.execute_batch(&batch).with_context(|| format!("writing the profile of {source}"))
}

const GAMERSCORE: &str = "SELECT SUM(points) AS score FROM game_achievement WHERE source = 'xbox' AND unlocked_at IS NOT NULL";

/// The gamerscore of every Xbox achievement unlocked, as far as the kept lists go: the number Xbox shows, for the games they cover.
pub fn xbox_gamerscore(db: &SqliteClient) -> Result<()> {
    let score = db.query(GAMERSCORE, &[])?.first().and_then(|row| row["score"].as_f64()).unwrap_or(0.0);
    if score > 0.0 {
        save(db, "xbox", &today(), &[Reading { key: "gamerscore", label: "Gamerscore", value: score, max: None }])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_gamerscore_is_the_points_of_what_is_unlocked() {
        let db = shared_data::app_db::memory_with_schema(include_str!("../../../../db/games.sql"));
        db.execute("INSERT INTO game_achievement (source, game, id, title, points, unlocked_at) VALUES ('xbox', '1', 'a', 'A', 15, 100), ('xbox', '1', 'b', 'B', 50, NULL), ('xbox', '2', 'c', 'C', 5, 200), ('steam', '9', 'd', 'D', 99, 300)", &[]).expect("insert");
        xbox_gamerscore(&db).expect("score");
        let rows = db.query("SELECT value FROM game_profile WHERE source = 'xbox' AND key = 'gamerscore'", &[]).expect("read");
        assert_eq!(rows[0]["value"].as_f64(), Some(20.0));
    }

    #[test]
    fn a_reading_is_kept_for_each_day_and_a_second_one_the_same_day_replaces_the_first() {
        let db = shared_data::app_db::memory_with_schema(include_str!("../../../../db/games.sql"));
        let level = |value| Reading { key: "level", label: "Nivå", value, max: None };
        save(&db, "steam", "2026-10-01", &[level(4.0)]).expect("save");
        save(&db, "steam", "2026-10-28", &[level(5.0)]).expect("save");
        save(&db, "steam", "2026-10-28", &[level(6.0)]).expect("save again");
        let rows = db.query("SELECT day, value FROM game_profile ORDER BY day", &[]).expect("read");
        assert_eq!(rows.iter().map(|row| row["value"].as_f64()).collect::<Vec<_>>(), vec![Some(4.0), Some(6.0)]);
    }
}
