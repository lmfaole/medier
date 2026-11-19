use anyhow::{Context, Result};
use shared_data::app_db::open_migrated;
use shared_data::sqlite_client::SqliteClient;
use std::path::Path;

pub const SCHEMA: &str = include_str!("../../../../db/podcast_history.sql");

/// Opens (creating if missing) the podcast history database at `path`, with its schema applied and its migrations
/// stamped, so `npm run snapshot` finds a database at the version it expects. Run from `apps/podkast`.
pub fn open_history_db(path: &Path) -> Result<SqliteClient> {
    open_migrated(path, SCHEMA, "podcast_history").context("opening the podcast history database")
}
