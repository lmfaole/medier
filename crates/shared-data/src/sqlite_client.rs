//! The local SQLite database (`.data/data.db`) behind the same three calls the
//! sync used on D1: send SQL with positional `?` parameters, get rows back as
//! JSON objects. Nothing here knows what the tables mean; that lives in each
//! app's own `sync.rs`/`aggregate.rs`. No network and no token: the file is on
//! this machine, and `npm run snapshot` publishes it from there.

use std::path::Path;

use anyhow::{bail, Context, Result};
use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde_json::{Map, Value};

pub struct SqliteClient {
    connection: Connection,
}

impl SqliteClient {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(directory) = path.parent().filter(|directory| !directory.as_os_str().is_empty()) {
            std::fs::create_dir_all(directory)
                .with_context(|| format!("could not create {}", directory.display()))?;
        }
        let connection = Connection::open(path)
            .with_context(|| format!("could not open {}", path.display()))?;
        // D1 always enforces foreign keys; SQLite only when asked, per connection.
        connection.execute_batch("PRAGMA foreign_keys = ON;")?;
        // Several tools and the snapshot open one file; WAL lets a reader through a write,
        // and the timeout makes a second writer wait instead of failing with "locked".
        connection.execute_batch("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;")?;
        Ok(SqliteClient { connection })
    }

    /// Runs one SQL statement with positional `?` parameters and returns the
    /// rows as JSON objects, in the order SQLite produced them.
    pub fn query(&self, sql: &str, params: &[Value]) -> Result<Vec<Value>> {
        let mut statement = self.connection.prepare(sql).with_context(|| format!("preparing {sql}"))?;
        let columns: Vec<String> = statement.column_names().into_iter().map(str::to_string).collect();
        let bound = params.iter().map(to_sql).collect::<Result<Vec<_>>>()?;
        let mut rows = statement.query(params_from_iter(bound)).with_context(|| format!("running {sql}"))?;
        let mut results = Vec::new();
        while let Some(row) = rows.next().context("reading a row")? {
            let mut object = Map::new();
            for (index, column) in columns.iter().enumerate() {
                object.insert(column.clone(), from_sql(row.get_ref(index)?)?);
            }
            results.push(Value::Object(object));
        }
        Ok(results)
    }

    /// Runs a statement for its side effect only, such as INSERT or DELETE.
    pub fn execute(&self, sql: &str, params: &[Value]) -> Result<()> {
        self.query(sql, params).map(|_| ())
    }

    /// Runs several statements in one transaction: a failing statement rolls
    /// back the ones before it, as D1's batch does.
    pub fn execute_batch(&self, statements: &[(String, Vec<Value>)]) -> Result<()> {
        let transaction = self.connection.unchecked_transaction()?;
        for (sql, params) in statements {
            self.execute(sql, params)?;
        }
        transaction.commit().context("committing the batch")
    }
}

fn to_sql(value: &Value) -> Result<SqlValue> {
    Ok(match value {
        Value::Null => SqlValue::Null,
        Value::Bool(flag) => SqlValue::Integer(i64::from(*flag)),
        Value::Number(number) => match (number.as_i64(), number.as_f64()) {
            (Some(integer), _) => SqlValue::Integer(integer),
            (None, Some(real)) => SqlValue::Real(real),
            (None, None) => bail!("{number} is not a SQLite number"),
        },
        Value::String(text) => SqlValue::Text(text.clone()),
        Value::Array(_) | Value::Object(_) => bail!("{value} is not a SQLite value"),
    })
}

fn from_sql(value: ValueRef<'_>) -> Result<Value> {
    Ok(match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(integer) => Value::from(integer),
        ValueRef::Real(real) => Value::from(real),
        ValueRef::Text(text) => Value::String(String::from_utf8(text.to_vec()).context("a text column is not UTF-8")?),
        ValueRef::Blob(_) => bail!("a blob column cannot be read as JSON"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn client() -> SqliteClient {
        let client = SqliteClient::open(Path::new(":memory:")).unwrap_or_else(|error| panic!("{error}"));
        client
            .execute("CREATE TABLE plays (id INTEGER PRIMARY KEY, name TEXT NOT NULL, minutes REAL)", &[])
            .unwrap_or_else(|error| panic!("{error}"));
        client
    }

    #[test]
    fn open_turns_on_wal_and_a_reader_is_not_blocked_by_a_write() {
        let path = std::env::temp_dir().join(format!("shared-data-wal-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let writer = SqliteClient::open(&path).unwrap_or_else(|error| panic!("{error}"));
        writer.execute("CREATE TABLE t (x INTEGER)", &[]).unwrap_or_else(|error| panic!("{error}"));
        writer.execute("INSERT INTO t VALUES (1)", &[]).unwrap_or_else(|error| panic!("{error}"));
        let reader = SqliteClient::open(&path).unwrap_or_else(|error| panic!("{error}"));
        writer.execute("BEGIN IMMEDIATE", &[]).unwrap_or_else(|error| panic!("{error}"));
        writer.execute("INSERT INTO t VALUES (2)", &[]).unwrap_or_else(|error| panic!("{error}"));

        let mode = reader.query("PRAGMA journal_mode", &[]).unwrap_or_else(|error| panic!("{error}"));
        let rows = reader.query("SELECT x FROM t", &[]).unwrap_or_else(|error| panic!("{error}"));

        assert_eq!(mode, vec![json!({"journal_mode": "wal"})]);
        assert_eq!(rows, vec![json!({"x": 1})]);
    }

    #[test]
    fn rows_come_back_as_json_objects_in_order() {
        let client = client();
        client.execute("INSERT INTO plays VALUES (?, ?, ?)", &[json!(2), json!("b"), json!(1.5)]).unwrap_or_else(|error| panic!("{error}"));
        client.execute("INSERT INTO plays VALUES (?, ?, ?)", &[json!(1), json!("a"), Value::Null]).unwrap_or_else(|error| panic!("{error}"));

        let rows = client.query("SELECT id, name, minutes FROM plays ORDER BY id", &[]).unwrap_or_else(|error| panic!("{error}"));

        assert_eq!(rows, vec![json!({"id": 1, "name": "a", "minutes": null}), json!({"id": 2, "name": "b", "minutes": 1.5})]);
    }

    #[test]
    fn a_failing_statement_rolls_back_the_batch() {
        let client = client();
        let batch = vec![
            ("INSERT INTO plays VALUES (1, 'a', NULL)".to_string(), vec![]),
            ("INSERT INTO plays VALUES (2, NULL, NULL)".to_string(), vec![]),
        ];

        assert!(client.execute_batch(&batch).is_err());
        assert_eq!(client.query("SELECT id FROM plays", &[]).unwrap_or_else(|error| panic!("{error}")), Vec::<Value>::new());
    }
}
