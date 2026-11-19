//! What a watch log and a shelf log do to their file and their table the same way: read the file, append checked
//! lines to it, and make the table exactly the file's lines. The columns and what a line means are each log's own.

use std::path::Path;

use anyhow::{Context, Result};
use serde_json::Value;

use crate::batch::insert_statements;
use crate::sqlite_client::SqliteClient;

/// The log's text, telling how to make the file when there is none.
pub fn read(path: &Path, made_by: &str) -> Result<String> {
    std::fs::read_to_string(path).with_context(|| format!("reading {}: «{made_by}» writes it", path.display()))
}

/// Adds already-checked lines to the file, with the header first when the file is new. `name` says what the file is.
pub fn append<I: IntoIterator<Item = Vec<String>>>(path: &Path, header: &[&str], name: &str, lines: I) -> Result<()> {
    let existed = path.exists();
    let file = std::fs::OpenOptions::new().create(true).append(true).open(path).with_context(|| format!("opening {}", path.display()))?;
    let mut writer = csv::Writer::from_writer(file);
    if !existed {
        writer.write_record(header).with_context(|| format!("writing the {name}'s header"))?;
    }
    for line in lines {
        writer.write_record(line)?;
    }
    writer.flush().with_context(|| format!("writing the {name}"))
}

/// Makes `table` exactly `rows`, one property per column, in one batch.
pub fn replace(db: &SqliteClient, table: &str, columns: &[&str], rows: Vec<Vec<Value>>, name: &str) -> Result<()> {
    let mut batch = vec![(format!("DELETE FROM {table}"), Vec::new())];
    batch.extend(insert_statements("INSERT INTO", table, columns, rows));
    db.execute_batch(&batch).with_context(|| format!("replacing {table} with the {name}'s lines"))
}
