//! How a data tool gets its database: the file named by an environment
//! variable (or a default beside the other apps' data), with the app's schema
//! applied. The schema is only idempotent statements, so applying it on every
//! run is a no-op on an up-to-date file and a new table arrives with the next run.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use crate::migrations;
use crate::sql_script::statements;
use crate::sqlite_client::SqliteClient;

/// The file named by `variable`, else `default`, which is relative to `apps/<app>/`.
#[must_use]
pub fn path_from_env(variable: &str, default: &str) -> PathBuf {
    std::env::var_os(variable).map_or_else(|| PathBuf::from(default), PathBuf::from)
}

pub fn apply_schema(db: &SqliteClient, schema: &str) -> Result<()> {
    let batch: Vec<(String, Vec<serde_json::Value>)> =
        statements(schema).into_iter().map(|sql| (sql, Vec::new())).collect();
    db.execute_batch(&batch).context("applying the schema")
}

pub fn open_with_schema(path: &Path, schema: &str) -> Result<SqliteClient> {
    let db = SqliteClient::open(path)?;
    apply_schema(&db, schema)?;
    Ok(db)
}

/// Like `open_with_schema`, and brings the file to the latest migration in
/// `migrations_dir`. An empty file gets the schema and is stamped; an existing
/// one is migrated first, so a column the schema now indexes is already there.
pub fn open_migrated_in(path: &Path, schema: &str, migrations_dir: &Path) -> Result<SqliteClient> {
    let db = SqliteClient::open(path)?;
    let tables = db.query("SELECT count(*) AS tables FROM sqlite_master WHERE type = 'table'", &[])?;
    let was_empty = tables.first().and_then(|row| row["tables"].as_i64()) == Some(0);
    let all = migrations::load(migrations_dir)?;
    if was_empty {
        apply_schema(&db, schema)?;
        migrations::migrate(&db, &all, true)?;
    } else {
        migrations::migrate(&db, &all, false)?;
        apply_schema(&db, schema)?;
    }
    Ok(db)
}

/// The tools run from `apps/<app>/`, where the repository's `db/` is two levels up.
pub fn open_migrated(path: &Path, schema: &str, database: &str) -> Result<SqliteClient> {
    open_migrated_in(path, schema, &Path::new("../../db/migrations").join(database))
}

/// Statements of `schema` that are not safe to run on every start. A tool's
/// test asserts this is empty for its own schema.
#[must_use]
pub fn unsafe_to_repeat(schema: &str) -> Vec<String> {
    statements(schema)
        .into_iter()
        .filter(|statement| {
            !(statement.contains("IF NOT EXISTS")
                || statement.starts_with("INSERT OR IGNORE")
                || statement.starts_with("DROP TABLE IF EXISTS"))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS a (x INTEGER); INSERT OR IGNORE INTO a VALUES (1);";

    #[test]
    fn applying_twice_is_fine() {
        let db = SqliteClient::open(Path::new(":memory:")).unwrap();
        assert!(apply_schema(&db, SCHEMA).is_ok());
        assert!(apply_schema(&db, SCHEMA).is_ok());
    }

    fn scratch(name: &str) -> (std::path::PathBuf, std::path::PathBuf) {
        let base = std::env::temp_dir().join(format!("app-db-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("migrations")).unwrap();
        (base.join("test.db"), base.join("migrations"))
    }

    #[test]
    fn an_empty_file_gets_the_schema_and_is_stamped() {
        let (path, migrations) = scratch("empty");
        std::fs::write(migrations.join("0001-baseline.sql"), "SELECT 1").unwrap();
        std::fs::write(migrations.join("0002-add-b.sql"), "ALTER TABLE a ADD COLUMN b INTEGER").unwrap();

        let db = open_migrated_in(&path, "CREATE TABLE IF NOT EXISTS a (x INTEGER, b INTEGER);", &migrations).unwrap();

        assert_eq!(db.query("PRAGMA user_version", &[]).unwrap()[0]["user_version"], 2);
    }

    #[test]
    fn an_existing_file_is_migrated_before_the_schema_runs_and_keeps_its_rows() {
        let (path, migrations) = scratch("existing");
        std::fs::write(migrations.join("0001-baseline.sql"), "SELECT 1").unwrap();
        std::fs::write(migrations.join("0002-add-b.sql"), "ALTER TABLE a ADD COLUMN b INTEGER").unwrap();
        let schema = "CREATE TABLE IF NOT EXISTS a (x INTEGER, b INTEGER); CREATE INDEX IF NOT EXISTS idx_a_b ON a (b);";
        {
            let old = SqliteClient::open(&path).unwrap();
            old.execute("CREATE TABLE a (x INTEGER)", &[]).unwrap();
            old.execute("INSERT INTO a VALUES (7)", &[]).unwrap();
        }

        let db = open_migrated_in(&path, schema, &migrations).unwrap();

        assert_eq!(db.query("SELECT x FROM a", &[]).unwrap()[0]["x"], 7);
        assert_eq!(db.query("PRAGMA user_version", &[]).unwrap()[0]["user_version"], 2);
        drop(db);
        assert_eq!(open_migrated_in(&path, schema, &migrations).unwrap().query("SELECT x FROM a", &[]).unwrap().len(), 1);
    }

    #[test]
    fn a_plain_create_is_flagged() {
        assert_eq!(unsafe_to_repeat("CREATE TABLE b (x INTEGER);"), vec!["CREATE TABLE b (x INTEGER)"]);
        assert!(unsafe_to_repeat(SCHEMA).is_empty());
    }
}

/// An empty in-memory database with `schema` applied, for the tools' tests.
///
/// # Panics
/// When the schema does not apply: a test cannot go on without it.
#[must_use]
pub fn memory_with_schema(schema: &str) -> SqliteClient {
    let db = SqliteClient::open(Path::new(":memory:")).unwrap_or_else(|error| panic!("{error}"));
    apply_schema(&db, schema).unwrap_or_else(|error| panic!("{error}"));
    db
}
