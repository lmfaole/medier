# shared-data

The plumbing the apps' Rust data tools share, so each tool owns only its own
domain logic. The `local-sqlite` feature (pulls in `rusqlite`) is what every
tool uses; nothing here reaches a network.

## Modules

| Module | Feature | Job |
| --- | --- | --- |
| `sqlite_client` | `local-sqlite` | The local SQLite database behind `query`, `execute` and `execute_batch`, below |
| `local_db` | `local-sqlite` | `open_fresh(path, schema)`: a new SQLite file with foreign keys on and a domain's schema applied |
| `static_api` | `local-sqlite` | `meta(connection, tables, fingerprints)`: the Norwegian-keyed `meta.json` of accounts, cv, photos and podcast |
| `fingerprint` | — | FNV-1a source fingerprints, which each app's `scripts/check-api-sync` recomputes in Node |
| `json_file` | — | `read_json`, and `write_json` with an explicit trailing newline (`Ending`) |
| `app_root` | — | `app_root("<APP>_APP")`: the app directory, overridable by that variable |

## The SQLite client

`shared_data::sqlite_client::SqliteClient`:

- `SqliteClient::from_env()` opens the file named by `DATA_DB`, else
  `../../.data/data.db` (the sync runs from `apps/<app>/`), with foreign keys on.
- `query(sql, params) -> anyhow::Result<Vec<serde_json::Value>>` runs one SQL
  statement with positional `?` parameters and returns the rows as JSON objects.
- `execute(sql, params)` runs a statement for side effects such as `INSERT`,
  `UPDATE` or `DELETE`.
- `execute_batch(statements)` runs several statements in one transaction: a
  failing one rolls the others back.

## Real usage

From `apps/music/sync-rust`, which depends on this crate:

```rust
use serde_json::json;
use shared_data::sqlite_client::SqliteClient;

let db = SqliteClient::from_env()?;
let rows = db.query("SELECT last_listened_at FROM sync_state WHERE id = 1", &[])?;

db.execute(
    "UPDATE sync_state SET last_listened_at = ?, last_synced_at = ? WHERE id = 1",
    &[json!(last_listened_at), json!(synced_at)],
)?;
```

## Build and test

From the repository root:

```sh
cargo build -p shared-data --all-features
cargo test -p shared-data --all-features
```
