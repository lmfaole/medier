//! Numbered migrations for a local database: the changes `CREATE TABLE IF NOT
//! EXISTS` cannot express (a new column, a dropped one, a rename). The stored
//! version is SQLite's own `PRAGMA user_version`.

use std::path::Path;

use anyhow::{bail, Context, Result};

use crate::sql_script::statements;
use crate::sqlite_client::SqliteClient;

pub struct Migration {
    pub version: u32,
    pub name: String,
    pub sql: String,
}

/// Reads `NNNN-name.sql` files, numbered 1, 2, 3 … with no gap or duplicate.
/// Other files in the directory are not migrations and are left alone.
pub fn load(directory: &Path) -> Result<Vec<Migration>> {
    let mut found = Vec::new();
    for entry in std::fs::read_dir(directory).with_context(|| format!("reading {}", directory.display()))? {
        let path = entry?.path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("sql") {
            continue;
        }
        let file = path.file_name().and_then(|name| name.to_str()).unwrap_or_default();
        let stem = file.trim_end_matches(".sql");
        let Some((number, name)) = stem.split_once('-') else {
            bail!("{file} is not named NNNN-name.sql");
        };
        let version: u32 = number.parse().with_context(|| format!("{file} does not start with a number"))?;
        if number.len() != 4 || name.is_empty() {
            bail!("{file} is not named NNNN-name.sql");
        }
        let sql = std::fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?;
        found.push(Migration { version, name: name.to_string(), sql });
    }
    found.sort_by_key(|migration| migration.version);
    for (index, migration) in found.iter().enumerate() {
        let expected = u32::try_from(index + 1)?;
        if migration.version != expected {
            bail!("migrations in {} must be numbered 1, 2, 3 … without gaps or repeats: found {} where {expected} was expected", directory.display(), migration.version);
        }
    }
    Ok(found)
}

/// Brings the database to the latest version and returns it. `was_empty` is
/// true when the file had no tables before its schema was applied: its shape is
/// already the latest, so it is stamped and nothing runs. Each migration and its
/// version bump are one transaction, so a failure leaves the version where it was.
pub fn migrate(db: &SqliteClient, migrations: &[Migration], was_empty: bool) -> Result<u32> {
    let latest = migrations.last().map_or(0, |migration| migration.version);
    if was_empty {
        db.execute(&format!("PRAGMA user_version = {latest}"), &[])?;
        return Ok(latest);
    }
    let stored = stored_version(db)?;
    if stored > latest {
        bail!("the database is at version {stored}, newer than the latest migration ({latest}); this tool is out of date");
    }
    for migration in migrations.iter().filter(|migration| migration.version > stored) {
        let mut batch: Vec<(String, Vec<serde_json::Value>)> =
            statements(&migration.sql).into_iter().map(|sql| (sql, Vec::new())).collect();
        batch.push((format!("PRAGMA user_version = {}", migration.version), Vec::new()));
        db.execute_batch(&batch).with_context(|| format!("migration {:04}-{}", migration.version, migration.name))?;
    }
    Ok(latest)
}

fn stored_version(db: &SqliteClient) -> Result<u32> {
    let rows = db.query("PRAGMA user_version", &[])?;
    let version = rows.first().and_then(|row| row["user_version"].as_u64()).context("reading PRAGMA user_version")?;
    Ok(u32::try_from(version)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fresh_db(name: &str) -> SqliteClient {
        let path = std::env::temp_dir().join(format!("migrations-{name}-{}.db", std::process::id()));
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
        }
        SqliteClient::open(&path).unwrap_or_else(|error| panic!("{error}"))
    }

    fn migration(version: u32, sql: &str) -> Migration {
        Migration { version, name: format!("step-{version}"), sql: sql.to_string() }
    }

    fn version(db: &SqliteClient) -> serde_json::Value {
        db.query("PRAGMA user_version", &[]).unwrap_or_else(|error| panic!("{error}"))[0]["user_version"].clone()
    }

    #[test]
    fn a_fresh_file_is_stamped_latest_without_running_anything() {
        let db = fresh_db("fresh");
        let migrations = [migration(1, "CREATE TABLE ran (x INTEGER)"), migration(2, "CREATE TABLE ran_too (x INTEGER)")];

        assert_eq!(migrate(&db, &migrations, true).unwrap_or_else(|error| panic!("{error}")), 2);

        assert_eq!(version(&db), json!(2));
        let tables = db.query("SELECT name FROM sqlite_master WHERE name LIKE 'ran%'", &[]).unwrap_or_else(|error| panic!("{error}"));
        assert!(tables.is_empty());
    }

    #[test]
    fn an_old_file_runs_only_the_pending_migrations_in_order() {
        let db = fresh_db("pending");
        db.execute("CREATE TABLE t (a INTEGER)", &[]).unwrap_or_else(|error| panic!("{error}"));
        db.execute("PRAGMA user_version = 1", &[]).unwrap_or_else(|error| panic!("{error}"));
        let migrations = [
            migration(1, "ALTER TABLE t ADD COLUMN never_runs INTEGER"),
            migration(2, "ALTER TABLE t ADD COLUMN b INTEGER"),
            migration(3, "ALTER TABLE t ADD COLUMN c INTEGER"),
        ];

        assert_eq!(migrate(&db, &migrations, false).unwrap_or_else(|error| panic!("{error}")), 3);

        let columns = db.query("SELECT name FROM pragma_table_info('t') ORDER BY cid", &[]).unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(columns, vec![json!({"name": "a"}), json!({"name": "b"}), json!({"name": "c"})]);
        assert_eq!(version(&db), json!(3));
    }

    #[test]
    fn a_failing_migration_leaves_the_version_unchanged_and_the_file_usable() {
        let db = fresh_db("failing");
        db.execute("CREATE TABLE t (a INTEGER)", &[]).unwrap_or_else(|error| panic!("{error}"));
        let migrations = [migration(1, "ALTER TABLE t ADD COLUMN b INTEGER; SELECT * FROM no_such_table")];

        assert!(migrate(&db, &migrations, false).is_err());

        assert_eq!(version(&db), json!(0));
        let columns = db.query("SELECT name FROM pragma_table_info('t')", &[]).unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(columns, vec![json!({"name": "a"})]);
        db.execute("INSERT INTO t VALUES (1)", &[]).unwrap_or_else(|error| panic!("{error}"));
    }

    #[test]
    fn a_populated_file_with_version_zero_is_not_treated_as_fresh() {
        let db = fresh_db("populated");
        db.execute("CREATE TABLE t (a INTEGER)", &[]).unwrap_or_else(|error| panic!("{error}"));
        let migrations = [migration(1, "ALTER TABLE t ADD COLUMN b INTEGER")];

        migrate(&db, &migrations, false).unwrap_or_else(|error| panic!("{error}"));

        let columns = db.query("SELECT name FROM pragma_table_info('t') ORDER BY cid", &[]).unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(columns, vec![json!({"name": "a"}), json!({"name": "b"})]);
    }

    #[test]
    fn a_file_newer_than_the_code_is_refused() {
        let db = fresh_db("newer");
        db.execute("PRAGMA user_version = 5", &[]).unwrap_or_else(|error| panic!("{error}"));

        assert!(migrate(&db, &[migration(1, "SELECT 1")], false).is_err());
    }

    #[test]
    fn load_reads_numbered_files_in_order_and_ignores_other_files() {
        let directory = std::env::temp_dir().join(format!("migrations-load-ok-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap_or_else(|error| panic!("{error}"));
        std::fs::write(directory.join("0002-add-b.sql"), "ALTER TABLE t ADD COLUMN b INTEGER").unwrap_or_else(|error| panic!("{error}"));
        std::fs::write(directory.join("0001-baseline.sql"), "SELECT 1").unwrap_or_else(|error| panic!("{error}"));
        std::fs::write(directory.join("README.md"), "not a migration").unwrap_or_else(|error| panic!("{error}"));

        let loaded = load(&directory).unwrap_or_else(|error| panic!("{error}"));

        let seen: Vec<(u32, &str)> = loaded.iter().map(|m| (m.version, m.name.as_str())).collect();
        assert_eq!(seen, vec![(1, "baseline"), (2, "add-b")]);
    }

    #[test]
    fn load_refuses_a_gap_a_duplicate_and_a_misnamed_file() {
        for (case, files) in [
            ("gap", vec!["0001-a.sql", "0003-c.sql"]),
            ("duplicate", vec!["0001-a.sql", "0001-b.sql"]),
            ("misnamed", vec!["0001-a.sql", "second.sql"]),
            ("from-zero", vec!["0000-a.sql"]),
        ] {
            let directory = std::env::temp_dir().join(format!("migrations-load-{case}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&directory);
            std::fs::create_dir_all(&directory).unwrap_or_else(|error| panic!("{error}"));
            for file in files {
                std::fs::write(directory.join(file), "SELECT 1").unwrap_or_else(|error| panic!("{error}"));
            }
            assert!(load(&directory).is_err(), "{case} should be refused");
        }
    }
}
