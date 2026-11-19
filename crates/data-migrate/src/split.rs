//! Moving tables out of the old shared `data.db` into the file of their own domain. The tables
//! a domain owns are the ones its schema declares, so the schema is the one list. A table is
//! copied with its rowids (a cursor such as `enrich_state.last_listen_rowid` points at them),
//! its rows are counted in both files, and only then is it dropped from the old file.
//! Idempotent: a table that is no longer in the old file is already moved.

use std::path::Path;

use anyhow::{bail, Context, Result};
use serde_json::json;
use shared_data::sqlite_client::SqliteClient;

/// The tables a schema creates, in the order it creates them (parents before children).
pub fn declared_tables(schema: &str) -> Vec<String> {
    shared_data::sql_script::statements(schema)
        .iter()
        .filter_map(|statement| {
            let rest = statement.strip_prefix("CREATE TABLE IF NOT EXISTS ").or_else(|| statement.strip_prefix("CREATE TABLE "))?;
            let name: String = rest.chars().take_while(|character| character.is_alphanumeric() || *character == '_').collect();
            (!name.is_empty()).then_some(name)
        })
        .collect()
}

#[derive(Debug, PartialEq, Eq)]
pub struct Moved {
    pub table: String,
    pub rows: usize,
}

fn count(db: &SqliteClient, qualified: &str) -> Result<usize> {
    let rows = db.query(&format!("SELECT count(*) AS n FROM {qualified}"), &[])?;
    Ok(usize::try_from(rows.first().and_then(|row| row["n"].as_i64()).unwrap_or(0))?)
}

/// The columns of `table` and whether its rowid is its own integer primary key.
fn columns(db: &SqliteClient, table: &str) -> Result<(Vec<String>, bool)> {
    let info = db.query(&format!("PRAGMA main.table_info({table})"), &[])?;
    let names = info.iter().filter_map(|row| row["name"].as_str().map(str::to_string)).collect();
    let keys: Vec<_> = info.iter().filter(|row| row["pk"].as_i64().unwrap_or(0) > 0).collect();
    let own_rowid = keys.len() == 1 && keys.first().is_some_and(|row| row["type"].as_str().is_some_and(|kind| kind.eq_ignore_ascii_case("INTEGER")));
    Ok((names, own_rowid))
}

/// Moves `tables` from `old` into the database file at `target`, which already has its schema.
/// Returns what moved; a table `old` does not have is skipped. Nothing is dropped unless every
/// table's rows arrived.
pub fn move_tables(old: &SqliteClient, target: &Path, tables: &[String]) -> Result<Vec<Moved>> {
    old.execute("PRAGMA foreign_keys = OFF", &[])?;
    old.execute("ATTACH DATABASE ? AS dst", &[json!(target.to_string_lossy())]).with_context(|| format!("attaching {}", target.display()))?;
    let result = copy_and_drop(old, tables);
    old.execute("DETACH DATABASE dst", &[])?;
    old.execute("PRAGMA foreign_keys = ON", &[])?;
    result
}

fn copy_and_drop(old: &SqliteClient, tables: &[String]) -> Result<Vec<Moved>> {
    let mut present = Vec::new();
    for table in tables {
        let found = old.query("SELECT count(*) AS n FROM main.sqlite_master WHERE type = 'table' AND name = ?", &[json!(table)])?;
        if found.first().and_then(|row| row["n"].as_i64()) == Some(1) {
            present.push(table.clone());
        }
    }
    let mut moved = Vec::new();
    for table in &present {
        let (names, own_rowid) = columns(old, table)?;
        let list = names.join(", ");
        let (into, from) = if own_rowid { (list.clone(), list) } else { (format!("rowid, {list}"), format!("rowid, {list}")) };
        old.execute(&format!("INSERT OR IGNORE INTO dst.{table} ({into}) SELECT {from} FROM main.{table}"), &[]).with_context(|| format!("copying {table}"))?;
        let (before, after) = (count(old, &format!("main.{table}"))?, count(old, &format!("dst.{table}"))?);
        if after < before {
            bail!("{table} has {before} rows in the old file but only {after} arrived; nothing was dropped");
        }
        moved.push(Moved { table: table.clone(), rows: before });
    }
    // Children before parents, so a foreign key never points at a table that is gone.
    for table in present.iter().rev() {
        old.execute(&format!("DROP TABLE main.{table}"), &[]).with_context(|| format!("dropping {table} from the old file"))?;
    }
    Ok(moved)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> std::path::PathBuf {
        let base = std::env::temp_dir().join(format!("data-migrate-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        base
    }

    const TARGET_SCHEMA: &str = "CREATE TABLE IF NOT EXISTS parent (id INTEGER PRIMARY KEY, name TEXT); \
        CREATE TABLE IF NOT EXISTS child (parent_id INTEGER NOT NULL REFERENCES parent (id), note TEXT); \
        CREATE TABLE IF NOT EXISTS loose (x TEXT);";

    fn old_with_rows(base: &Path) -> SqliteClient {
        let old = SqliteClient::open(&base.join("old.db")).unwrap();
        old.execute("CREATE TABLE parent (id INTEGER PRIMARY KEY, name TEXT)", &[]).unwrap();
        old.execute("CREATE TABLE child (parent_id INTEGER NOT NULL REFERENCES parent (id), note TEXT)", &[]).unwrap();
        old.execute("CREATE TABLE loose (x TEXT)", &[]).unwrap();
        old.execute("CREATE TABLE stays (z TEXT)", &[]).unwrap();
        old.execute("INSERT INTO parent VALUES (4, 'a'), (9, 'b')", &[]).unwrap();
        old.execute("INSERT INTO child VALUES (4, 'one'), (9, 'two')", &[]).unwrap();
        old.execute("INSERT INTO loose (rowid, x) VALUES (7, 'first'), (12, 'second')", &[]).unwrap();
        old.execute("INSERT INTO stays VALUES ('left behind')", &[]).unwrap();
        old
    }

    fn target_with_schema(base: &Path) -> std::path::PathBuf {
        let path = base.join("new.db");
        let db = SqliteClient::open(&path).unwrap();
        shared_data::app_db::apply_schema(&db, TARGET_SCHEMA).unwrap();
        path
    }

    #[test]
    fn a_schema_names_its_tables_in_order() {
        assert_eq!(declared_tables(TARGET_SCHEMA), vec!["parent", "child", "loose"]);
        assert_eq!(declared_tables("-- CREATE TABLE no (x);\nCREATE INDEX i ON a (x);\nCREATE TABLE plain (x);"), vec!["plain"]);
    }

    #[test]
    fn the_declared_tables_move_with_their_rows_and_rowids_and_the_others_stay() {
        let base = scratch("moves");
        let old = old_with_rows(&base);
        let target = target_with_schema(&base);

        let moved = move_tables(&old, &target, &declared_tables(TARGET_SCHEMA)).unwrap();

        assert_eq!(moved.iter().map(|m| (m.table.as_str(), m.rows)).collect::<Vec<_>>(), vec![("parent", 2), ("child", 2), ("loose", 2)]);
        let new = SqliteClient::open(&target).unwrap();
        assert_eq!(new.query("SELECT rowid AS r, x FROM loose ORDER BY r", &[]).unwrap().iter().map(|row| row["r"].as_i64().unwrap()).collect::<Vec<_>>(), vec![7, 12]);
        assert_eq!(new.query("SELECT id FROM parent ORDER BY id", &[]).unwrap().len(), 2);
        let left = old.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name", &[]).unwrap();
        assert_eq!(left.iter().map(|row| row["name"].as_str().unwrap()).collect::<Vec<_>>(), vec!["stays"]);
    }

    #[test]
    fn a_second_run_moves_nothing() {
        let base = scratch("again");
        let old = old_with_rows(&base);
        let target = target_with_schema(&base);
        let tables = declared_tables(TARGET_SCHEMA);
        move_tables(&old, &target, &tables).unwrap();

        assert!(move_tables(&old, &target, &tables).unwrap().is_empty());
        assert_eq!(SqliteClient::open(&target).unwrap().query("SELECT count(*) AS n FROM loose", &[]).unwrap()[0]["n"], 2);
    }

    #[test]
    fn nothing_is_dropped_when_a_copy_is_short() {
        let base = scratch("short");
        let old = old_with_rows(&base);
        let target = target_with_schema(&base);
        // A trigger that swallows the rows stands in for any reason they do not arrive.
        SqliteClient::open(&target).unwrap().execute("CREATE TRIGGER swallow BEFORE INSERT ON loose BEGIN SELECT RAISE(IGNORE); END", &[]).unwrap();

        assert!(move_tables(&old, &target, &declared_tables(TARGET_SCHEMA)).is_err());
        assert_eq!(count(&old, "main.loose").unwrap(), 2);
        assert_eq!(count(&old, "main.parent").unwrap(), 2);
    }
}
