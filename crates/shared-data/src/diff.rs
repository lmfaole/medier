//! Writes a derived table by changing only the rows that differ from what is
//! already there. A sync that deletes and re-inserts a whole table rewrites
//! rows that come out identical (and every index entry with them). Reading is
//! far cheaper than writing, so the table is read, compared with what the sync
//! just computed, and only new, changed and gone rows are written.

use anyhow::Result;
use serde_json::Value;
use std::collections::{HashMap, HashSet};

use crate::batch::insert_statements;
use crate::sqlite_client::SqliteClient;

pub type Row = Vec<Value>;

/// A table's shape: the columns in the order rows are given, how many of the
/// first ones are the primary key, and how many of the first ones decide
/// whether a row changed (a trailing `computed_at` that moves on every sync
/// must not count).
pub struct Table {
    pub name: &'static str,
    pub columns: &'static [&'static str],
    pub key_len: usize,
    pub compare_len: usize,
}

#[derive(Debug, PartialEq)]
pub struct Changes {
    /// New rows and rows whose compared columns differ, whole.
    pub upserts: Vec<Row>,
    /// The keys of rows that exist but are no longer wanted.
    pub deletes: Vec<Row>,
}

/// What has to be written to turn `existing` into `desired`. Rows are matched
/// on their first `key_len` values.
#[must_use]
pub fn plan(existing: &[Row], desired: &[Row], key_len: usize, compare_len: usize) -> Changes {
    let key = |row: &Row| row.iter().take(key_len).cloned().collect::<Vec<Value>>();
    let compared = |row: &Row| row.iter().take(compare_len).cloned().collect::<Vec<Value>>();
    // Looked up by the key as text: comparing every row with every other is quadratic, and the tables are thousands of rows.
    let text = |row: &Row| serde_json::to_string(&key(row)).unwrap_or_default();
    let have: HashMap<String, &Row> = existing.iter().map(|row| (text(row), row)).collect();
    let wanted: HashSet<String> = desired.iter().map(text).collect();

    let upserts = desired.iter().filter(|row| !have.get(&text(row)).is_some_and(|found| compared(found) == compared(row))).cloned().collect();
    let deletes = existing.iter().filter(|row| !wanted.contains(&text(row))).map(key).collect();
    Changes { upserts, deletes }
}

/// The statements for `changes`: multi-row `INSERT OR REPLACE`, as many rows
/// to a statement as the parameter cap allows, then one `DELETE` per gone key.
#[must_use]
pub fn statements(table: &Table, changes: &Changes) -> Vec<(String, Vec<Value>)> {
    let mut statements = insert_statements("INSERT OR REPLACE INTO", table.name, table.columns, changes.upserts.iter().cloned());
    let key_columns = &table.columns[..table.key_len];
    let condition = key_columns.iter().map(|column| format!("{column} = ?")).collect::<Vec<_>>().join(" AND ");
    statements.extend(
        changes
            .deletes
            .iter()
            .map(|key| (format!("DELETE FROM {} WHERE {condition}", table.name), key.clone())),
    );
    statements
}

/// Brings `table` (or, with `scope`, the rows whose column equals the value)
/// to exactly `desired`, writing only the difference. Returns how many rows
/// were written or deleted.
pub fn sync_table(db: &SqliteClient, table: &Table, scope: Option<(&str, &Value)>, desired: &[Row]) -> Result<usize> {
    let columns = table.columns.join(", ");
    let (sql, params) = match scope {
        Some((column, value)) => (format!("SELECT {columns} FROM {} WHERE {column} = ?", table.name), vec![value.clone()]),
        None => (format!("SELECT {columns} FROM {}", table.name), Vec::new()),
    };
    reconcile(db, table, &sql, &params, desired)
}

/// `sync_table` for the rows whose `column` is at least `from`: a job that
/// only recomputes the recent part of a table must not read, or delete, the rest.
pub fn sync_table_since(db: &SqliteClient, table: &Table, column: &str, from: &Value, desired: &[Row]) -> Result<usize> {
    let columns = table.columns.join(", ");
    let sql = format!("SELECT {columns} FROM {} WHERE {column} >= ?", table.name);
    reconcile(db, table, &sql, std::slice::from_ref(from), desired)
}

fn reconcile(db: &SqliteClient, table: &Table, sql: &str, params: &[Value], desired: &[Row]) -> Result<usize> {
    let existing: Vec<Row> = db
        .query(sql, params)?
        .iter()
        .map(|row| table.columns.iter().map(|column| row[*column].clone()).collect())
        .collect();

    let changes = plan(&existing, desired, table.key_len, table.compare_len);
    let written = changes.upserts.len() + changes.deletes.len();
    if written > 0 {
        db.execute_batch(&statements(table, &changes))?;
    }
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const FACTS: Table = Table {
        name: "period_facts",
        columns: &["period_key", "fact_key", "data", "computed_at"],
        key_len: 2,
        compare_len: 3,
    };

    fn row(period: &str, key: &str, data: &str, at: i64) -> Row {
        vec![json!(period), json!(key), json!(data), json!(at)]
    }

    #[test]
    fn an_identical_table_writes_nothing_even_when_computed_at_moved() {
        let have = vec![row("all", "a", "{}", 1), row("2026", "a", "{}", 1)];
        let want = vec![row("all", "a", "{}", 99), row("2026", "a", "{}", 99)];
        assert_eq!(plan(&have, &want, 2, 3), Changes { upserts: vec![], deletes: vec![] });
    }

    #[test]
    fn new_and_changed_rows_are_upserted_and_gone_rows_deleted() {
        let have = vec![row("all", "a", "1", 1), row("all", "b", "2", 1), row("all", "gone", "3", 1)];
        let want = vec![row("all", "a", "1", 5), row("all", "b", "20", 5), row("all", "new", "4", 5)];
        let changes = plan(&have, &want, 2, 3);
        assert_eq!(changes.upserts, vec![row("all", "b", "20", 5), row("all", "new", "4", 5)]);
        assert_eq!(changes.deletes, vec![vec![json!("all"), json!("gone")]]);
    }

    #[test]
    fn statements_stay_under_the_parameter_cap_and_delete_by_key() {
        let upserts: Vec<Row> = (0..60).map(|index| row("all", &format!("k{index}"), "{}", 1)).collect();
        let changes = Changes { upserts, deletes: vec![vec![json!("all"), json!("gone")]] };
        let statements = statements(&FACTS, &changes);

        // 100 parameters / 4 columns = 25 rows a statement: 60 rows take three, plus the delete.
        assert_eq!(statements.len(), 4);
        assert!(statements.iter().all(|(_, params)| params.len() <= crate::batch::MAX_PARAMETERS));
        assert!(statements[0].0.starts_with("INSERT OR REPLACE INTO period_facts (period_key, fact_key, data, computed_at) VALUES (?, ?, ?, ?), "));
        assert_eq!(statements[3].0, "DELETE FROM period_facts WHERE period_key = ? AND fact_key = ?");
        assert_eq!(statements[3].1, vec![json!("all"), json!("gone")]);
    }

    #[test]
    fn nothing_changed_means_no_statements() {
        assert_eq!(statements(&FACTS, &Changes { upserts: vec![], deletes: vec![] }), vec![]);
    }
}
