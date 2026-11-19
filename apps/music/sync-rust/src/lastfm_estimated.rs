//! Last.fm plays that came without a usable time (the account's export numbered them 1, 2, 3 ...) and were given a
//! guessed one by a person: a JSON list of `{ "t", "a", "n", "al" }` (unix seconds, artist, track, album). They go
//! into `listens` like any other play and are also recorded in `listen_date_estimate`, so the guesses can be told
//! apart and removed together. The times are fixed in the file, so a second run adds nothing.

use std::path::Path;

use anyhow::{Context, Result};
use serde::Deserialize;
use serde_json::json;
use shared_data::job::Job;
use shared_data::batch::insert_statements;
use shared_data::sqlite_client::SqliteClient;

use crate::models::Listen;
use crate::sync::insert_listens;

const ESTIMATE_COLUMNS: &[&str] = &["listened_at", "track_name", "artist_name", "source"];
const COUNT_ESTIMATES: &str = "SELECT COUNT(*) AS n FROM listen_date_estimate WHERE source = ?";

#[derive(Debug, Deserialize)]
struct Placed {
    t: i64,
    a: String,
    n: String,
    #[serde(default)]
    al: Option<String>,
}

fn read_placed(path: &Path) -> Result<Vec<Placed>> {
    let text = std::fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
    serde_json::from_str(&text).with_context(|| format!("parsing {}", path.display()))
}

fn estimated_count(db: &SqliteClient, source: &str) -> Result<i64> {
    let rows = db.query(COUNT_ESTIMATES, &[json!(source)])?;
    Ok(rows.first().and_then(|row| row["n"].as_i64()).unwrap_or(0))
}

pub fn import(db: &SqliteClient, path: &Path, source: &str, dry_run: bool) -> Result<()> {
    let placed = read_placed(path)?;
    let before = estimated_count(db, source)?;
    println!("read {} placed plays; {before} already recorded as estimated from {source}", placed.len());
    if dry_run {
        println!("dry run: nothing written");
        return Ok(());
    }
    let listens: Vec<Listen> = placed
        .iter()
        .map(|play| Listen {
            listened_at: play.t,
            track_name: play.n.clone(),
            artist_name: play.a.clone(),
            release_name: play.al.clone(),
            recording_mbid: None,
            artist_mbid: None,
            release_mbid: None,
            duration_ms: None,
        })
        .collect();
    insert_listens(db, &listens).context("writing the listens")?;
    let rows = placed.iter().map(|play| vec![json!(play.t), json!(play.n), json!(play.a), json!(source)]);
    db.execute_batch(&insert_statements("INSERT OR IGNORE INTO", "listen_date_estimate", ESTIMATE_COLUMNS, rows)).context("recording the estimates")?;
    println!("estimated plays recorded from {source}: {} (was {before})", estimated_count(db, source)?);
    Ok(())
}

pub fn job() -> Job<SqliteClient> {
    Job::new("import-lastfm-estimated", "add plays with a guessed time from a JSON list, recorded in listen_date_estimate under <source>", |db, args| {
        import(db, Path::new(args.positional(0)), args.positional(1), args.flag("--dry-run"))
    })
    .takes(&["file", "source"])
    .flags(&["--dry-run"])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(name: &str, body: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("{name}-{}.json", std::process::id()));
        std::fs::write(&path, body).unwrap();
        path
    }

    fn database() -> SqliteClient {
        let db = SqliteClient::open(Path::new(":memory:")).unwrap();
        crate::schema::apply(&db).unwrap();
        db
    }

    #[test]
    fn placed_plays_become_listens_marked_as_estimated_and_a_second_run_adds_nothing() {
        let path = file("lastfm-estimated", r#"[{"t":1340000000,"a":"Artist","n":"Song","al":"Album"},{"t":1340000100,"a":"Artist","n":"Other","al":null}]"#);
        let db = database();

        import(&db, &path, "test", false).unwrap();
        import(&db, &path, "test", false).unwrap();

        assert_eq!(db.query("SELECT COUNT(*) AS n FROM listens", &[]).unwrap()[0]["n"], 2);
        assert_eq!(estimated_count(&db, "test").unwrap(), 2);
        let album = db.query("SELECT release_name FROM listens WHERE track_name = 'Song'", &[]).unwrap();
        assert_eq!(album[0]["release_name"], "Album");
    }

    #[test]
    fn a_dry_run_writes_nothing() {
        let path = file("lastfm-estimated-dry", r#"[{"t":1340000000,"a":"Artist","n":"Song"}]"#);
        let db = database();

        import(&db, &path, "test", true).unwrap();

        assert!(db.query("SELECT 1 FROM listens", &[]).unwrap().is_empty());
    }
}
