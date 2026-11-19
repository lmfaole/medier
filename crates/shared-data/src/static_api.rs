//! The `meta.json` that accounts, cv, photos and podcast publish beside their
//! static API. Its keys are Norwegian because they are the contract
//! `scripts/check-api-sync` and the pages read.

use anyhow::Result;
use rusqlite::Connection;
use serde_json::{json, Value};

/// `{ kilder: [{ fil, fingeravtrykk }], tabeller: [{ tabell, rader }] }`, with
/// each table's row count read back from the database just built.
pub fn meta(connection: &Connection, tables: &[&str], fingerprints: &[(String, String)]) -> Result<Value> {
    let mut table_counts = Vec::new();
    for table in tables {
        let rows: i64 = connection.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| row.get(0))?;
        table_counts.push(json!({ "tabell": table, "rader": rows }));
    }
    let sources: Vec<Value> = fingerprints
        .iter()
        .map(|(file, fingerprint)| json!({ "fil": file, "fingeravtrykk": fingerprint }))
        .collect();
    Ok(json!({ "kilder": sources, "tabeller": table_counts }))
}
