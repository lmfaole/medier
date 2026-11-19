//! Podcasts are not music, so they live in a database of their own (`.data/podcasts.db`,
//! `db/podcasts.sql`) and `listens` holds music only. `split-podcasts` keeps it so: it moves every
//! listen of a show (`podcast_shows` there), or a news clip scrobbled with its headline as the
//! artist, across. Idempotent: a second run finds nothing to do.

use anyhow::{Context, Result};
use serde_json::{json, Value};
use shared_data::batch::insert_statements;
use shared_data::sqlite_client::SqliteClient;

pub(crate) const SCHEMA: &str = include_str!("../../../../db/podcasts.sql");

const LISTEN_COLUMNS: [&str; 8] = ["listened_at", "track_name", "artist_name", "release_name", "recording_mbid", "artist_mbid", "release_mbid", "duration_ms"];
const SQL_SHOWS: &str = "SELECT artist_name FROM podcast_shows";
const SQL_PODCAST_LISTENS: &str = "SELECT listened_at, track_name, artist_name, release_name, recording_mbid, artist_mbid, release_mbid, duration_ms \
    FROM listens WHERE artist_name IN (SELECT value FROM json_each(?)) \
       OR track_name IN (SELECT value FROM json_each(?)) \
       OR (release_name IS NULL AND recording_mbid IS NULL AND COALESCE(duration_ms, 0) >= 600000)";
const SQL_DELETE_LISTEN: &str = "DELETE FROM listens WHERE listened_at = ? AND track_name = ? AND artist_name = ?";

fn values_of(row: &Value, columns: &[&str]) -> Vec<Value> {
    columns.iter().map(|column| row[*column].clone()).collect()
}

/// Moves every podcast play out of `listens` and into `podcast_listens`, and returns how many moved.
pub fn split(data: &SqliteClient, podcasts: &SqliteClient) -> Result<usize> {
    let shows: Vec<Value> = podcasts.query(SQL_SHOWS, &[])?.iter().map(|row| row["artist_name"].clone()).collect();
    let shows = json!(Value::Array(shows).to_string());
    // ListenBrainz names the show as the artist; Last.fm scrobbles the show as the track and the episode as the artist.
    let rows = data.query(SQL_PODCAST_LISTENS, &[shows.clone(), shows])?;
    if rows.is_empty() {
        return Ok(0);
    }
    let insert = insert_statements("INSERT OR IGNORE INTO", "podcast_listens", &LISTEN_COLUMNS, rows.iter().map(|row| values_of(row, &LISTEN_COLUMNS)));
    podcasts.execute_batch(&insert).context("copying the podcast plays")?;
    let delete: Vec<(String, Vec<Value>)> =
        rows.iter().map(|row| (SQL_DELETE_LISTEN.to_string(), values_of(row, &["listened_at", "track_name", "artist_name"]))).collect();
    data.execute_batch(&delete).context("removing the podcast plays from listens")?;
    Ok(rows.len())
}

/// The `split-podcasts` job.
pub fn run(data: &SqliteClient, podcasts: &SqliteClient) -> Result<()> {
    let moved = split(data, podcasts)?;
    println!("moved {moved} podcast plays out of listens");
    if moved > 0 {
        println!("next: daily-plays all, all-time-totals, summaries all, facts all, memories, capsules, entities");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn podcasts() -> SqliteClient {
        let db = SqliteClient::open(Path::new(":memory:")).unwrap();
        shared_data::app_db::apply_schema(&db, SCHEMA).unwrap();
        db
    }

    fn data() -> SqliteClient {
        let db = SqliteClient::open(Path::new(":memory:")).unwrap();
        crate::schema::apply(&db).unwrap();
        db
    }

    fn listen(db: &SqliteClient, at: i64, track: &str, artist: &str, release: Option<&str>, mbid: Option<&str>, duration: Option<i64>) {
        db.execute(
            "INSERT INTO listens (listened_at, track_name, artist_name, release_name, recording_mbid, duration_ms) VALUES (?, ?, ?, ?, ?, ?)",
            &[json!(at), json!(track), json!(artist), json!(release), json!(mbid), json!(duration)],
        )
        .unwrap();
    }

    fn tracks(db: &SqliteClient, table: &str) -> Vec<String> {
        db.query(&format!("SELECT track_name FROM {table} ORDER BY listened_at"), &[]).unwrap().iter().filter_map(|row| row["track_name"].as_str().map(str::to_string)).collect()
    }

    #[test]
    fn a_listen_of_a_show_and_a_long_clip_move_and_music_stays() {
        let (data, podcasts) = (data(), podcasts());
        podcasts.execute("INSERT INTO podcast_shows (artist_name) VALUES ('Debatten')", &[]).unwrap();
        listen(&data, 1, "a song", "Band", Some("Album"), Some("rec"), Some(200_000));
        listen(&data, 2, "episode of a listed show", "Debatten", None, None, Some(60_000));
        listen(&data, 3, "a headline clip", "Some headline", None, None, Some(900_000));
        listen(&data, 4, "a short unmapped song", "Someone", None, None, Some(120_000));

        assert_eq!(split(&data, &podcasts).unwrap(), 2);

        assert_eq!(tracks(&data, "listens"), vec!["a song", "a short unmapped song"]);
        assert_eq!(tracks(&podcasts, "podcast_listens"), vec!["episode of a listed show", "a headline clip"]);
    }

    #[test]
    fn a_last_fm_scrobble_has_the_show_as_its_track() {
        let (data, podcasts) = (data(), podcasts());
        podcasts.execute("INSERT INTO podcast_shows (artist_name) VALUES ('Dagsnytt 18')", &[]).unwrap();
        listen(&data, 1, "Dagsnytt 18", "An episode title", None, None, None);
        listen(&data, 2, "a song", "Band", Some("Album"), None, None);
        assert_eq!(split(&data, &podcasts).unwrap(), 1);
        assert_eq!(tracks(&data, "listens"), vec!["a song"]);
    }

    #[test]
    fn a_second_split_moves_nothing() {
        let (data, podcasts) = (data(), podcasts());
        podcasts.execute("INSERT INTO podcast_shows (artist_name) VALUES ('Debatten')", &[]).unwrap();
        listen(&data, 1, "episode", "Debatten", None, None, None);
        assert_eq!(split(&data, &podcasts).unwrap(), 1);
        assert_eq!(split(&data, &podcasts).unwrap(), 0);
        assert_eq!(podcasts.query("SELECT count(*) AS n FROM podcast_listens", &[]).unwrap()[0]["n"], 1);
    }

    #[test]
    fn the_podcast_schema_is_safe_to_apply_on_every_start() {
        assert!(shared_data::app_db::unsafe_to_repeat(SCHEMA).is_empty());
    }
}
