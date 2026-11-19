//! What Spotify says was played last, with where it was played from (a playlist, an album, an artist radio). Spotify
//! keeps only the last 50 plays and nothing older, so each run adds the new ones to `spotify_play` and replaces nothing;
//! the same play seen twice is one row. The answer is landed unchanged under `.data/raw/spotify-recent/<date>/`.
//! The scrobblers stay the record of what was listened to; this is the one place the context of a play is kept.

use anyhow::{Context, Result};
use serde::Deserialize;
use serde_json::json;
use shared_data::batch::insert_statements;
use shared_data::job::Job;
use shared_data::sqlite_client::SqliteClient;

use crate::spotify_api::API;

const COLUMNS: &[&str] = &["played_at", "spotify_id", "track_name", "artist_name", "context_type", "context_uri"];
const SQL_COUNT: &str = "SELECT COUNT(*) AS n FROM spotify_play";

#[derive(Debug, PartialEq, Eq)]
pub struct Play {
    pub played_at: i64,
    pub spotify_id: String,
    pub track_name: String,
    pub artist_name: String,
    pub context_type: Option<String>,
    pub context_uri: Option<String>,
}

#[derive(Deserialize)]
struct Envelope {
    items: Vec<Item>,
}

#[derive(Deserialize)]
struct Item {
    played_at: String,
    track: Option<Track>,
    context: Option<PlayContext>,
}

#[derive(Deserialize)]
struct Track {
    id: Option<String>,
    name: String,
    #[serde(default)]
    artists: Vec<Named>,
}

#[derive(Deserialize)]
struct Named {
    name: String,
}

#[derive(Deserialize)]
struct PlayContext {
    #[serde(rename = "type")]
    kind: String,
    uri: String,
}

/// The plays of one answer. A local file has no track id and is left out.
pub fn parse(json: &str) -> Result<Vec<Play>> {
    let envelope = serde_json::from_str::<Envelope>(json).context("reading Spotify's recently played")?;
    Ok(envelope
        .items
        .into_iter()
        .filter_map(|item| {
            let track = item.track?;
            Some(Play {
                played_at: chrono::DateTime::parse_from_rfc3339(&item.played_at).ok()?.timestamp(),
                spotify_id: track.id?,
                track_name: track.name,
                artist_name: track.artists.into_iter().next()?.name,
                context_type: item.context.as_ref().map(|context| context.kind.clone()),
                context_uri: item.context.map(|context| context.uri),
            })
        })
        .collect())
}

fn count(db: &SqliteClient) -> Result<i64> {
    let rows = db.query(SQL_COUNT, &[]).context("counting the Spotify plays")?;
    Ok(rows.first().and_then(|row| row["n"].as_i64()).unwrap_or(0))
}

/// Adds the plays; the number new to the table is returned.
pub fn add(db: &SqliteClient, plays: &[Play]) -> Result<i64> {
    let before = count(db)?;
    let rows = plays.iter().map(|p| vec![json!(p.played_at), json!(p.spotify_id), json!(p.track_name), json!(p.artist_name), json!(p.context_type), json!(p.context_uri)]);
    db.execute_batch(&insert_statements("INSERT OR IGNORE INTO", "spotify_play", COLUMNS, rows)).context("adding the Spotify plays")?;
    Ok(count(db)? - before)
}

/// The `spotify-recent` job: the last plays Spotify remembers, added to what is kept.
pub fn sync(db: &SqliteClient) -> Result<()> {
    let http = crate::spotify_api::client()?;
    let token = crate::spotify_api::access_token(&http)?;
    let text = crate::spotify_api::send(&http, &token, &reqwest::Method::GET, &format!("{API}/me/player/recently-played?limit=50"))
        .context("run `likes-auth spotify` again if the sign-in predates the recently-played scope")?;
    let directory = crate::lastfm::fresh_landing("spotify-recent", chrono::Utc::now().date_naive())?;
    let path = directory.join("recent.json");
    std::fs::write(&path, &text).with_context(|| format!("writing {}", path.display()))?;
    let plays = parse(&text)?;
    println!("{} plays seen, {} new", plays.len(), add(db, &plays)?);
    Ok(())
}

#[must_use]
pub fn jobs() -> Vec<Job<SqliteClient>> {
    vec![Job::new("spotify-recent", "add the plays Spotify remembers, with where they were played from", |db, _| sync(db))]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_play_keeps_its_context_and_a_local_file_is_left_out() {
        let json = json!({"items": [
            {"played_at": "2024-03-01T12:00:00.123Z", "track": {"id": "t1", "name": "Song", "artists": [{"name": "A"}, {"name": "B"}]}, "context": {"type": "playlist", "uri": "spotify:playlist:p"}},
            {"played_at": "2024-03-01T12:05:00Z", "track": {"id": "t2", "name": "Alone", "artists": [{"name": "A"}]}, "context": null},
            {"played_at": "2024-03-01T12:10:00Z", "track": {"id": null, "name": "Local", "artists": [{"name": "A"}]}, "context": null}
        ]})
        .to_string();
        let plays = parse(&json).unwrap();
        assert_eq!(plays.len(), 2);
        assert_eq!((plays[0].artist_name.as_str(), plays[0].context_type.as_deref(), plays[0].played_at), ("A", Some("playlist"), 1_709_294_400));
        assert_eq!(plays[1].context_uri, None);
    }
}
