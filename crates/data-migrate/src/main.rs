//! `npm run data:migrate`: applies each database's pending migrations
//! (`db/migrations/<name>/`) so a tool that opens it later finds the latest shape.
//! Run from the repository root. A database that does not exist yet is skipped,
//! not created: the tool that owns it makes it on its first run.
//!
//! `data-migrate split` is the one-time move out of the old shared `data.db`: every domain's
//! tables go to the file of their own (`split.rs`), counted before they are dropped. Back
//! `data.db` up first; there is no other copy.

mod split;

use std::path::Path;

use anyhow::{bail, Context, Result};
use shared_data::app_db::{open_migrated_in, path_from_env};
use shared_data::sqlite_client::SqliteClient;

/// Name, the variable that moves the file, its default path and its schema: one row per data domain.
const DATABASES: [(&str, &str, &str, &str); 14] = [
    ("music", "MUSIC_DB", ".data/music.db", include_str!("../../../db/music.sql")),
    ("podcasts", "PODCAST_DB", ".data/podcasts.db", include_str!("../../../db/podcasts.sql")),
    ("podcast_history", "PODCAST_HISTORY_DB", ".data/podcast_history.db", include_str!("../../../db/podcast_history.sql")),
    ("film", "FILM_DB", ".data/film.db", include_str!("../../../db/film.sql")),
    ("tv", "TV_DB", ".data/tv.db", include_str!("../../../db/tv.sql")),
    ("games", "GAMES_DB", ".data/games.db", include_str!("../../../db/games.sql")),
    ("books", "BOOKS_DB", ".data/books.db", include_str!("../../../db/books.sql")),
    ("boardgames", "BOARDGAMES_DB", ".data/boardgames.db", include_str!("../../../db/boardgames.sql")),
    ("github", "GITHUB_DB", ".data/github.db", include_str!("../../../db/github.sql")),
    ("cv", "CV_DB", ".data/cv.db", include_str!("../../../db/cv.sql")),
    ("accounts", "ACCOUNTS_DB", ".data/accounts.db", include_str!("../../../db/accounts.sql")),
    ("photos", "PHOTOS_DB", ".data/photos.db", include_str!("../../../db/photos.sql")),
    ("site", "SITE_DB", ".data/site.db", include_str!("../../../db/site.sql")),
    ("platform", "PLATFORM_DB", ".data/platform.db", include_str!("../../../db/platform.sql")),
];

fn migrate() -> Result<()> {
    for (name, variable, default, schema) in DATABASES {
        let path = path_from_env(variable, default);
        if !path.exists() {
            println!("{name}: {} does not exist, skipped", path.display());
            continue;
        }
        let directory = Path::new("db/migrations").join(name);
        let db = open_migrated_in(&path, schema, &directory).with_context(|| format!("migrating {name}"))?;
        let version = db.query("PRAGMA user_version", &[])?;
        println!("{name}: version {}", version.first().map_or(0, |row| row["user_version"].as_u64().unwrap_or(0)));
    }
    Ok(())
}

fn split_old_data() -> Result<()> {
    let old_path = path_from_env("DATA_DB", ".data/data.db");
    if !old_path.exists() {
        bail!("{} does not exist: nothing to split", old_path.display());
    }
    let old = SqliteClient::open(&old_path)?;
    for (name, variable, default, schema) in DATABASES {
        let tables = split::declared_tables(schema);
        let path = path_from_env(variable, default);
        // Creates the file with its schema and stamps it at the latest migration; only its path is needed after.
        drop(open_migrated_in(&path, schema, &Path::new("db/migrations").join(name)).with_context(|| format!("opening {name}"))?);
        let moved = split::move_tables(&old, &path, &tables).with_context(|| format!("moving {name}"))?;
        if moved.is_empty() {
            println!("{name}: nothing to move");
        }
        for table in moved {
            println!("{name}: moved {} ({} rows)", table.table, table.rows);
        }
    }
    let left = old.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite%' ORDER BY name", &[])?;
    let names: Vec<&str> = left.iter().filter_map(|row| row["name"].as_str()).collect();
    println!("left in {}: {}", old_path.display(), if names.is_empty() { "nothing".to_string() } else { names.join(", ") });
    Ok(())
}

fn main() -> Result<()> {
    match std::env::args().nth(1).as_deref() {
        None => migrate(),
        Some("split") => split_old_data(),
        Some(other) => bail!("unknown command {other}; run without one to migrate, or `split`"),
    }
}
