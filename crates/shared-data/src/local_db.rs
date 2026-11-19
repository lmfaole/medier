//! The local SQLite file each data tool builds and then dumps for D1.

use std::path::Path;

use anyhow::{Context, Result};
use rusqlite::Connection;

/// Deletes `path`, opens it fresh and applies `schema`. The file is a build
/// artefact, so rebuilding it from nothing is the only way that stays right
/// when the schema changes.
pub fn open_fresh(path: &Path, schema: &str) -> Result<Connection> {
    // A missing file is the normal first run, and `open` reports a real problem.
    let _ = std::fs::remove_file(path);
    let connection = Connection::open(path).with_context(|| format!("could not open {}", path.display()))?;
    // D1 always enforces foreign keys; SQLite only when asked, per connection.
    connection.execute_batch("PRAGMA foreign_keys = ON;")?;
    connection.execute_batch(schema).with_context(|| format!("could not create the schema in {}", path.display()))?;
    Ok(connection)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_old_file_is_replaced_and_foreign_keys_hold() {
        let path = std::env::temp_dir().join("shared-data-local-db-test.db");
        std::fs::write(&path, "not a database").unwrap();
        let schema = "CREATE TABLE parent (id INTEGER PRIMARY KEY);
                      CREATE TABLE child (parent_id INTEGER NOT NULL REFERENCES parent (id));";

        let connection = open_fresh(&path, schema).unwrap();
        assert!(connection.execute("INSERT INTO child (parent_id) VALUES (1)", []).is_err());
    }
}
