//! The tracklist of each album, asked of MusicBrainz (one request a second, the most played album first) so an album's
//! page lists every track in the album's order. The release is the one the file `music-albums.csv` pins, else the one
//! most plays are on. An album of the collection that was never played has its tracklist too, under the key
//! `collection:<artist>\0<title>` as the collection writes them: the release Discogs names, or else MusicBrainz's search. Each answer is landed unchanged under `.data/raw/musicbrainz/<date>/` before it is read.

use crate::musicbrainz_extra::get;
use crate::scope::music_only;
use anyhow::Result;
use serde_json::{json, Value};
use shared_data::diff::{sync_table, Row, Table};
use shared_data::shelf::{landing, now};
use shared_data::sqlite_client::SqliteClient;
use shared_data::tmdb::land;
use std::collections::{HashMap, HashSet};

const API: &str = "https://musicbrainz.org/ws/2";

const ALBUM_TRACK: Table = Table { name: "album_track", columns: &["album_key", "disc", "position", "title", "recording_mbid", "length_ms", "artist_credit"], key_len: 3, compare_len: 7 };

// Every release an album's plays are on, with how many; the pinned release of the file first.
const SQL_RELEASES: &str = concat!(
    "SELECT album_key, MAX(album_variant.release_mbid) AS pinned, recording_metadata.caa_release_mbid AS release_mbid, COUNT(*) AS plays \
     FROM listens JOIN album_variant ON album_variant.release_name = listens.release_name AND album_variant.artist_name = listens.artist_name \
          LEFT JOIN recording_metadata USING (recording_mbid) WHERE ",
    music_only!(),
    " GROUP BY album_key, recording_metadata.caa_release_mbid ORDER BY plays DESC"
);
// The albums of the collection, with the MusicBrainz release that Discogs names for the copy where it does.
const SQL_COLLECTION: &str = "SELECT DISTINCT collection.artist, collection.title, cover.release_mbid FROM music_collection AS collection \
     LEFT JOIN discogs_item AS item ON collection.note = 'discogs:' || item.instance_id LEFT JOIN discogs_cover AS cover ON cover.release_id = item.release_id \
     WHERE collection.kind = 'album' AND collection.title != ''";
const SQL_FETCHED: &str = "SELECT album_key, release_mbid FROM album_tracklist";

#[derive(Debug, PartialEq, Eq)]
pub struct TrackRow {
    pub disc: i64,
    pub position: i64,
    pub title: String,
    pub recording_mbid: Option<String>,
    pub length_ms: Option<i64>,
    pub artist_credit: Option<String>,
}

/// «Artist feat. Guest» from the credit's names and the words that join them.
fn credit_of(credit: &Value) -> Option<String> {
    let mut text = String::new();
    for part in credit.as_array()? {
        text.push_str(part["name"].as_str().unwrap_or_default());
        text.push_str(part["joinphrase"].as_str().unwrap_or_default());
    }
    (!text.is_empty()).then_some(text)
}

/// The tracks of a MusicBrainz release in disc and track order.
#[must_use]
pub fn tracks_of(release: &Value) -> Vec<TrackRow> {
    let mut rows = Vec::new();
    for (index, medium) in release["media"].as_array().into_iter().flatten().enumerate() {
        let disc = medium["position"].as_i64().unwrap_or(i64::try_from(index).unwrap_or(0) + 1);
        for (at, track) in medium["tracks"].as_array().into_iter().flatten().enumerate() {
            let Some(title) = track["title"].as_str() else { continue };
            rows.push(TrackRow {
                disc,
                position: track["position"].as_i64().unwrap_or(i64::try_from(at).unwrap_or(0) + 1),
                title: title.to_string(),
                recording_mbid: track["recording"]["id"].as_str().map(str::to_string),
                length_ms: track["length"].as_i64(),
                artist_credit: credit_of(&track["artist-credit"]),
            });
        }
    }
    rows
}

/// For each album that has no tracklist of the release it should have, that release; the most played albums first.
fn pending(db: &SqliteClient) -> Result<Vec<(String, String)>> {
    let fetched: HashMap<String, String> = db.query(SQL_FETCHED, &[])?.iter().map(|row| (crate::entities::text(&row["album_key"]), crate::entities::text(&row["release_mbid"]))).collect();
    let mut chosen: Vec<(String, String)> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for row in db.query(SQL_RELEASES, &[])? {
        let key = crate::entities::text(&row["album_key"]);
        let pinned = crate::entities::text(&row["pinned"]);
        let release = if pinned.is_empty() { row["release_mbid"].as_str().unwrap_or_default().to_string() } else { pinned };
        if release.is_empty() || !seen.insert(key.clone()) {
            continue;
        }
        if fetched.get(&key) != Some(&release) {
            chosen.push((key, release));
        }
    }
    Ok(chosen)
}

/// The key a collection album's tracklist is kept under: its artist and title as the collection spells them.
#[must_use]
pub fn collection_key(artist: &str, title: &str) -> String {
    format!("collection:{artist}\u{0}{title}")
}

/// The release of a MusicBrainz search that has the most tracks among those it names with a score that leaves little
/// doubt (the full edition, not a single of the same name), with that many tracks; none when no release is that sure.
fn release_in_search(answer: &Value) -> Option<(String, usize)> {
    let sure = answer["releases"].as_array()?.iter().filter(|found| found["score"].as_i64().unwrap_or_default() >= 90);
    let best = sure.fold(None::<(&Value, i64)>, |best, found| {
        let tracks = found["track-count"].as_i64().unwrap_or_default();
        if best.is_none_or(|(_, most)| tracks > most) { Some((found, tracks)) } else { best }
    })?;
    Some((best.0["id"].as_str()?.to_string(), usize::try_from(best.1).unwrap_or_default()))
}

/// A release with so few tracks is likelier a single or a stray relation than the album.
const FEW_TRACKS: usize = 5;

/// A MusicBrainz query value in quotes, so a quote or a backslash in a title cannot end it.
fn quoted(text: &str) -> String {
    format!("\"{}\"", text.replace('\\', "").replace('"', "\\\""))
}

/// The albums of the collection that have no tracklist yet, with the
/// release when Discogs gives one, else empty for the search to find.
fn collection_pending(db: &SqliteClient) -> Result<Vec<(String, String, String, String)>> {
    let fetched: HashMap<String, String> = db.query(SQL_FETCHED, &[])?.iter().map(|row| (crate::entities::text(&row["album_key"]), crate::entities::text(&row["release_mbid"]))).collect();
    let mut chosen = Vec::new();
    for row in db.query(SQL_COLLECTION, &[])? {
        let (artist, title) = (crate::entities::text(&row["artist"]), crate::entities::text(&row["title"]));
        let key = collection_key(&artist, &title);
        let release = row["release_mbid"].as_str().unwrap_or_default().to_string();
        if !fetched.contains_key(&key) {
            chosen.push((key, release, artist, title));
        }
    }
    Ok(chosen)
}

/// Stores one album's tracklist: its tracks and the release they are from; how many tracks it has, or none where the release is gone.
fn store(db: &SqliteClient, directory: &std::path::Path, client: &reqwest::blocking::Client, key: &str, release: &str) -> Result<Option<usize>> {
    let Some(answer) = get(client, &format!("{API}/release/{release}"), &[("inc", "recordings+artist-credits"), ("fmt", "json")])? else { return Ok(None) };
    land(&directory.join(format!("release-tracks-{release}.json")), &answer)?;
    let tracks = tracks_of(&answer);
    let desired: Vec<Row> = tracks.iter().map(|track| vec![json!(key), json!(track.disc), json!(track.position), json!(track.title), json!(track.recording_mbid), json!(track.length_ms), json!(track.artist_credit)]).collect();
    sync_table(db, &ALBUM_TRACK, Some(("album_key", &json!(key))), &desired)?;
    db.execute("INSERT INTO album_tracklist (album_key, release_mbid, fetched_at) VALUES (?, ?, ?) ON CONFLICT(album_key) DO UPDATE SET release_mbid = excluded.release_mbid, fetched_at = excluded.fetched_at", &[json!(key), json!(release), json!(now())])?;
    Ok(Some(tracks.len()))
}

pub fn run(db: &SqliteClient, limit: usize) -> Result<()> {
    let client = crate::listenbrainz::http_client()?;
    let directory = landing("musicbrainz")?;
    let mut stored = 0;
    let mut spent = 0;
    // The albums of the collection first: there are few, and a page of one that was never played has nothing else to list.
    for (key, known, artist, title) in collection_pending(db)?.into_iter().take(limit) {
        spent += 1;
        let mut kept = if known.is_empty() { None } else { store(db, &directory, &client, &key, &known)? };
        if kept.is_none_or(|tracks| tracks < FEW_TRACKS) {
            let query = format!("release:{} AND artist:{}", quoted(&title), quoted(&artist));
            let Some(answer) = get(&client, &format!("{API}/release"), &[("query", &query), ("limit", "10"), ("fmt", "json")])? else { continue };
            land(&directory.join(format!("search-{}.json", shared_data::text::slug(&key))), &answer)?;
            if let Some((release, _)) = release_in_search(&answer).filter(|(release, tracks)| *tracks > kept.unwrap_or_default() && *release != known) {
                kept = store(db, &directory, &client, &key, &release)?.or(kept);
            }
        }
        if kept.is_some() {
            stored += 1;
        }
    }
    for (key, release) in pending(db)?.into_iter().take(limit.saturating_sub(spent)) {
        if store(db, &directory, &client, &key, &release)?.is_some() {
            stored += 1;
        }
    }
    println!("album-tracklists: {stored} tracklists stored");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracks_come_in_disc_and_track_order_with_what_musicbrainz_knows() {
        let release = json!({ "media": [
            { "position": 1, "tracks": [{ "position": 1, "title": "One", "length": 1000, "recording": { "id": "r1" }, "artist-credit": [{ "name": "Band", "joinphrase": " feat. " }, { "name": "Guest", "joinphrase": "" }] }, { "position": 2, "title": "Two", "length": null, "recording": {} }] },
            { "position": 2, "tracks": [{ "position": 1, "title": "Three" }, { "position": 2 }] }
        ] });
        assert_eq!(
            tracks_of(&release),
            vec![
                TrackRow { disc: 1, position: 1, title: "One".into(), recording_mbid: Some("r1".into()), length_ms: Some(1000), artist_credit: Some("Band feat. Guest".into()) },
                TrackRow { disc: 1, position: 2, title: "Two".into(), recording_mbid: None, length_ms: None, artist_credit: None },
                TrackRow { disc: 2, position: 1, title: "Three".into(), recording_mbid: None, length_ms: None, artist_credit: None },
            ]
        );
        assert!(tracks_of(&json!({})).is_empty());
    }

    #[test]
    fn a_search_names_a_release_only_when_it_is_nearly_certain() {
        assert_eq!(release_in_search(&json!({ "releases": [{ "id": "r1", "score": 100 }, { "id": "r2", "score": 100 }] })), Some(("r1".to_string(), 0)));
        // The edition with the most tracks wins over a single of the same name.
        assert_eq!(release_in_search(&json!({ "releases": [{ "id": "single", "score": 100, "track-count": 1 }, { "id": "album", "score": 95, "track-count": 12 }, { "id": "other", "score": 40, "track-count": 30 }] })), Some(("album".to_string(), 12)));
        assert_eq!(release_in_search(&json!({ "releases": [{ "id": "r1", "score": 60 }] })), None);
        assert_eq!(release_in_search(&json!({})), None);
        assert_eq!(quoted("a\"b\\"), "\"a\\\"b\"");
    }
}
