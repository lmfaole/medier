//! One achievement as the services give it, and how a game's list is kept: replaced as a whole in one transaction, so
//! an achievement the service removed goes too and one run cannot leave half a game.

use anyhow::{Context, Result};
use serde_json::json;
use shared_data::batch::insert_statements;
use shared_data::sqlite_client::SqliteClient;

#[derive(Debug, Default, PartialEq)]
pub struct Achievement {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub points: Option<i64>,
    pub rarity: Option<f64>,
    pub unlocked_at: Option<i64>,
    /// How far it is, and what the next step asks; the tier reached of a medal with tiers, and how many it has.
    pub progress: Option<f64>,
    pub target: Option<f64>,
    pub tier: Option<i64>,
    pub tiers: Option<i64>,
}

const DELETE_GAME: &str = "DELETE FROM game_achievement WHERE source = ? AND game = ?";

pub fn save(db: &SqliteClient, source: &str, game: &str, achievements: &[Achievement]) -> Result<()> {
    let mut batch = vec![(DELETE_GAME.to_string(), vec![json!(source), json!(game)])];
    batch.extend(insert_statements(
        "INSERT OR REPLACE INTO",
        "game_achievement",
        &["source", "game", "id", "title", "description", "icon", "points", "rarity", "unlocked_at", "progress", "target", "tier", "tiers"],
        achievements.iter().map(|a| vec![json!(source), json!(game), json!(a.id), json!(a.title), json!(a.description), json!(a.icon), json!(a.points), json!(a.rarity), json!(a.unlocked_at), json!(a.progress), json!(a.target), json!(a.tier), json!(a.tiers)]),
    ));
    db.execute_batch(&batch).with_context(|| format!("storing the achievements of {source}:{game}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn count(db: &SqliteClient) -> i64 {
        db.query("SELECT COUNT(*) AS n FROM game_achievement", &[]).ok().and_then(|rows| rows[0]["n"].as_i64()).unwrap_or(-1)
    }

    #[test]
    fn a_game_is_replaced_whole_and_other_games_are_left() {
        let db = shared_data::app_db::memory_with_schema(include_str!("../../../../db/games.sql"));
        let one = |id: &str| Achievement { id: id.to_string(), title: id.to_string(), ..Achievement::default() };
        save(&db, "steam", "1", &[one("a"), one("b")]).expect("save");
        save(&db, "steam", "2", &[one("a")]).expect("save");
        save(&db, "steam", "1", &[one("a")]).expect("save again");
        assert_eq!(count(&db), 2);
    }
}
