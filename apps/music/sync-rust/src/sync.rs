//! Reads and advances the sync bookmark, and writes fetched listens to the local database.
//! Aggregation lives in `aggregate.rs`; this file only owns getting raw rows
//! into the `listens` table.

use shared_data::sqlite_client::SqliteClient;
use crate::models::Listen;
use anyhow::Result;
use serde_json::json;
use shared_data::batch::insert_statements;

const LISTEN_COLUMNS: &[&str] = &[
    "listened_at",
    "track_name",
    "artist_name",
    "release_name",
    "recording_mbid",
    "artist_mbid",
    "release_mbid",
    "duration_ms",
];

pub fn read_bookmark(db: &SqliteClient) -> Result<i64> {
    let rows = db.query("SELECT last_listened_at FROM sync_state WHERE id = 1", &[])?;
    Ok(rows
        .first()
        .and_then(|row| row["last_listened_at"].as_i64())
        .unwrap_or(0))
}

pub fn write_bookmark(db: &SqliteClient, last_listened_at: i64, synced_at: i64) -> Result<()> {
    db.execute(
        "UPDATE sync_state SET last_listened_at = ?, last_synced_at = ? WHERE id = 1",
        &[json!(last_listened_at), json!(synced_at)],
    )
}

pub fn insert_listens(db: &SqliteClient, listens: &[Listen]) -> Result<()> {
    // All statements for a page go in one transaction, so a first sync that
    // backfills years of history commits once per page.
    let rows = listens.iter().map(|listen| {
        vec![
            json!(listen.listened_at),
            json!(listen.track_name),
            json!(listen.artist_name),
            json!(listen.release_name),
            json!(listen.recording_mbid),
            json!(listen.artist_mbid),
            json!(listen.release_mbid),
            json!(listen.duration_ms),
        ]
    });
    db.execute_batch(&insert_statements("INSERT OR IGNORE INTO", "listens", LISTEN_COLUMNS, rows))
}
