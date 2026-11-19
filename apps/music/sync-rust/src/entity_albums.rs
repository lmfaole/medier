//! The album pages: for each of the most played albums and every one the owner has or wants (an album is what `album_variant` makes of its spellings), totals, the year it came out, the tracks heard from
//! it and plays per year.

use crate::entities::{count, minutes, text, years_json, Entity};
use crate::scope::music_only;
use crate::album_key::album_key;
use crate::album_tracks::{tracks_json, Heard, Listed};
use crate::slug::slug_of;
use anyhow::Result;
use serde_json::{json, Value};
use shared_data::sqlite_client::SqliteClient;
use std::collections::{HashMap, HashSet};

const PROFILED_ALBUMS: usize = 300;

// An album is every spelling `album_variant` gives one key, so "B'Day" and "B'Day (Deluxe Edition)" are one page.
const SQL_ALBUMS: &str = concat!(
    "SELECT album_key, MAX(album_name) AS release_name, MAX(album_artist) AS artist_name, COUNT(*) AS plays, \
            SUM(COALESCE(listens.duration_ms, recording_metadata.length_ms, 210000)) AS listened_ms, \
            MIN(listened_at) AS first_at, MAX(listened_at) AS last_at, MAX(recording_metadata.release_year) AS release_year, \
            MAX(CASE WHEN caa_release_mbid IS NOT NULL AND caa_id IS NOT NULL THEN caa_release_mbid || '/' || caa_id END) AS cover, \
           MAX(release_group_info.primary_type) AS release_type, MAX(release_group_info.secondary_types) AS secondary_types, MAX(release_label.label) AS label \
     FROM listens JOIN album_variant ON album_variant.release_name = listens.release_name AND album_variant.artist_name = listens.artist_name \
          LEFT JOIN recording_metadata USING (recording_mbid) \
          LEFT JOIN release_group_info ON release_group_info.release_group_mbid = recording_metadata.release_group_mbid \
          LEFT JOIN release_label ON release_label.release_mbid = recording_metadata.caa_release_mbid WHERE ",
    music_only!(),
    " GROUP BY album_key ORDER BY plays DESC, release_name, artist_name"
);
// The releases the plays of each album were matched to, with what is known of each: the album's cover, kind, label and
// year come from one of them (`release_of`), not from the largest value across all of them.
const SQL_RELEASES: &str = concat!(
    "SELECT album_key, recording_metadata.caa_release_mbid AS release_mbid, COUNT(*) AS plays, \
            MAX(CASE WHEN caa_id IS NOT NULL THEN caa_release_mbid || '/' || caa_id END) AS cover, MAX(recording_metadata.release_year) AS release_year, \
            MAX(release_group_info.primary_type) AS release_type, MAX(release_group_info.secondary_types) AS secondary_types, MAX(release_label.label) AS label \
     FROM listens JOIN album_variant ON album_variant.release_name = listens.release_name AND album_variant.artist_name = listens.artist_name \
          JOIN recording_metadata USING (recording_mbid) \
          LEFT JOIN release_group_info ON release_group_info.release_group_mbid = recording_metadata.release_group_mbid \
          LEFT JOIN release_label ON release_label.release_mbid = recording_metadata.caa_release_mbid \
     WHERE album_key IN (SELECT value FROM json_each(?)) AND recording_metadata.caa_release_mbid IS NOT NULL AND ",
    music_only!(),
    " GROUP BY album_key, recording_metadata.caa_release_mbid"
);
const SQL_TRACKLIST_RELEASES: &str = "SELECT album_key, release_mbid FROM album_tracklist WHERE album_key IN (SELECT value FROM json_each(?))";
const SQL_COLLECTED: &str = "SELECT artist, title FROM music_collection WHERE kind = 'album'";
// The albums are given as one JSON array of keys.
const SQL_TRACKS: &str = concat!(
    "SELECT album_key, listens.track_name AS track_name, MAX(listens.recording_mbid) AS recording_mbid, COUNT(*) AS plays, MIN(listened_at) AS first_at, MAX(listened_at) AS last_at, \
            MAX(recording_metadata.length_ms) AS length_ms, MAX(recording_metadata.release_year) AS release_year, MAX(COALESCE(recording_feedback.score, 0) = 1) AS loved \
     FROM listens JOIN album_variant ON album_variant.release_name = listens.release_name AND album_variant.artist_name = listens.artist_name \
          LEFT JOIN recording_metadata USING (recording_mbid) LEFT JOIN recording_feedback USING (recording_mbid) \
     WHERE album_key IN (SELECT value FROM json_each(?)) AND ",
    music_only!(),
    " GROUP BY album_key, listens.track_name"
);
const SQL_TRACK_GENRES: &str = concat!(
    "SELECT album_key, track_name, genre, COUNT(*) AS plays FROM listens \
     JOIN album_variant ON album_variant.release_name = listens.release_name AND album_variant.artist_name = listens.artist_name \
     JOIN recording_genres USING (recording_mbid) WHERE album_key IN (SELECT value FROM json_each(?)) AND ",
    music_only!(),
    " GROUP BY album_key, track_name, genre"
);
const SQL_TRACKLIST: &str = "SELECT album_key, disc, position, title, recording_mbid, length_ms, artist_credit FROM album_track \
     WHERE album_key IN (SELECT value FROM json_each(?)) ORDER BY album_key, disc, position";
const SQL_YEARS: &str = concat!(
    "SELECT album_key, CAST(strftime('%Y', datetime(listened_at, 'unixepoch')) AS INTEGER) AS year, COUNT(*) AS plays \
     FROM listens JOIN album_variant ON album_variant.release_name = listens.release_name AND album_variant.artist_name = listens.artist_name \
     WHERE album_key IN (SELECT value FROM json_each(?)) AND ",
    music_only!(),
    " GROUP BY album_key, year"
);

fn key(row: &Value) -> String {
    text(&row["album_key"])
}

/// The release an album's facts come from: the one its tracklist is (`tracklist`) when plays were matched to it, else the one
/// most plays were matched to. A track of a live album is often matched to the studio album or a single it is also on, so the
/// largest cover, kind or label across all of them is another record's («Single» outranks «Album»).
fn release_of<'a>(releases: &'a [Value], tracklist: Option<&str>) -> Option<&'a Value> {
    releases
        .iter()
        .find(|release| tracklist.is_some_and(|wanted| release["release_mbid"].as_str() == Some(wanted)))
        .or_else(|| releases.iter().max_by(|a, b| count(&a["plays"]).cmp(&count(&b["plays"])).then_with(|| text(&b["release_mbid"]).cmp(&text(&a["release_mbid"])))))
}

/// The `limit` most played albums, then every other one whose key is in `collected`.
fn profiled(ranked: Vec<Value>, collected: &HashSet<String>, limit: usize) -> Vec<Value> {
    ranked.into_iter().enumerate().filter(|(rank, album)| *rank < limit || collected.contains(&key(album))).map(|(_, album)| album).collect()
}

pub fn albums(db: &SqliteClient) -> Result<Vec<Entity>> {
    // An album the owner has or wants always has its page, however few plays: the library joins a line to a page by it.
    let collected: HashSet<String> = db.query(SQL_COLLECTED, &[])?.iter().map(|line| album_key(&text(&line["artist"]), &text(&line["title"]))).collect();
    let top = profiled(db.query(SQL_ALBUMS, &[])?, &collected, PROFILED_ALBUMS);
    let pairs = json!(Value::Array(top.iter().map(|album| album["album_key"].clone()).collect()).to_string());

    let mut genres: HashMap<(String, String), Vec<(String, i64)>> = HashMap::new();
    for row in db.query(SQL_TRACK_GENRES, std::slice::from_ref(&pairs))? {
        genres.entry((key(&row), text(&row["track_name"]))).or_default().push((text(&row["genre"]), count(&row["plays"])));
    }
    let mut tracks: HashMap<String, Vec<Heard>> = HashMap::new();
    for row in db.query(SQL_TRACKS, std::slice::from_ref(&pairs))? {
        let track = text(&row["track_name"]);
        tracks.entry(key(&row)).or_default().push(Heard {
            recording_mbid: row["recording_mbid"].as_str().map(str::to_string),
            plays: count(&row["plays"]),
            first_at: count(&row["first_at"]),
            last_at: count(&row["last_at"]),
            length_ms: row["length_ms"].as_i64(),
            release_year: row["release_year"].as_i64(),
            loved: count(&row["loved"]) == 1,
            genres: genres.remove(&(key(&row), track.clone())).unwrap_or_default(),
            track,
        });
    }
    let mut tracklists: HashMap<String, Vec<Listed>> = HashMap::new();
    for row in db.query(SQL_TRACKLIST, std::slice::from_ref(&pairs))? {
        tracklists.entry(key(&row)).or_default().push(Listed { disc: count(&row["disc"]), position: count(&row["position"]), title: text(&row["title"]), recording_mbid: row["recording_mbid"].as_str().map(str::to_string), length_ms: row["length_ms"].as_i64(), artist_credit: row["artist_credit"].as_str().map(str::to_string) });
    }
    let mut releases: HashMap<String, Vec<Value>> = HashMap::new();
    for row in db.query(SQL_RELEASES, std::slice::from_ref(&pairs))? {
        releases.entry(key(&row)).or_default().push(row);
    }
    let tracklist_releases: HashMap<String, String> = db.query(SQL_TRACKLIST_RELEASES, std::slice::from_ref(&pairs))?.iter().map(|row| (key(row), text(&row["release_mbid"]))).collect();
    let mut years: HashMap<String, Vec<(i64, i64)>> = HashMap::new();
    for row in db.query(SQL_YEARS, std::slice::from_ref(&pairs))? {
        years.entry(key(&row)).or_default().push((count(&row["year"]), count(&row["plays"])));
    }

    Ok(top
        .iter()
        .map(|album| {
            let key = key(album);
            let candidates = releases.remove(&key).unwrap_or_default();
            // Each fact from the chosen release where it has one, else what the album's plays say together.
            let fact = |name: &str| release_of(&candidates, tracklist_releases.get(&key).map(String::as_str)).map(|release| release[name].clone()).filter(|value| !value.is_null()).unwrap_or_else(|| album[name].clone());
            let (heard_count, listed) = tracks_json(tracks.remove(&key).unwrap_or_default(), &tracklists.remove(&key).unwrap_or_default(), &text(&album["artist_name"]), album["release_year"].as_i64());
            Entity {
                kind: "album",
                slug: slug_of(&[&text(&album["release_name"]), &text(&album["artist_name"])]),
                name: text(&album["release_name"]),
                artist_name: text(&album["artist_name"]),
                cover: fact("cover").as_str().map(str::to_string),
                play_count: count(&album["plays"]),
                detail: json!({
                    "minutes": minutes(&album["listened_ms"]),
                    "first_at": album["first_at"],
                    "last_at": album["last_at"],
                    "release_type": fact("release_type"),
                    "secondary_types": fact("secondary_types"),
                    "label": fact("label"),
                    "release_year": fact("release_year"),
                    "years": years_json(years.remove(&key).unwrap_or_default()),
                    "tracks_heard": heard_count,
                    "tracks": listed,
                }),
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entities::test_support::TestDatabase;

    #[test]
    fn the_facts_come_from_the_tracklists_release_else_the_most_played_one() {
        let releases = vec![
            json!({ "release_mbid": "studio", "plays": 90, "release_type": "Single" }),
            json!({ "release_mbid": "live", "plays": 40, "release_type": "Album" }),
        ];
        assert_eq!(release_of(&releases, Some("live")).map(|release| text(&release["release_type"])), Some("Album".to_string()));
        assert_eq!(release_of(&releases, Some("unheard")).map(|release| text(&release["release_mbid"])), Some("studio".to_string()));
        assert_eq!(release_of(&releases, None).map(|release| text(&release["release_mbid"])), Some("studio".to_string()));
        assert!(release_of(&[], None).is_none());
    }

    #[test]
    fn an_album_of_the_collection_is_profiled_below_the_limit() {
        let ranked: Vec<Value> = ["a", "b", "c", "d"].iter().map(|album_key| json!({ "album_key": album_key })).collect();
        let kept = profiled(ranked, &HashSet::from(["d".to_string()]), 2);
        assert_eq!(kept.iter().map(key).collect::<Vec<_>>(), ["a", "b", "d"]);
    }

    #[test]
    fn an_album_is_its_name_and_artist_with_the_tracks_heard_and_its_years() {
        let database = TestDatabase::with(
            "INSERT INTO listens (listened_at, track_name, artist_name, release_name, recording_mbid) VALUES
               (1570579200, 'One', 'Band', 'Self-titled', 'r1'), (1570665600, 'One', 'Band', 'Self-titled', 'r1'),
               (1602201600, 'Two', 'Band', 'Self-titled', 'r2'), (1602201700, 'Other', 'Another', 'Self-titled', NULL),
               (1570579300, 'Single', 'Band', NULL, NULL);
             INSERT INTO recording_metadata (recording_mbid, release_year, caa_release_mbid, caa_id, fetched_at)
               VALUES ('r1', 2001, 'rel-1', 7, 0), ('r2', 2001, NULL, NULL, 0);
             UPDATE recording_metadata SET release_group_mbid = 'rg-1' WHERE recording_mbid = 'r1';
             INSERT INTO release_group_info (release_group_mbid, primary_type, secondary_types, fetched_at) VALUES ('rg-1', 'Album', 'Live', 0);
             INSERT INTO release_label (release_mbid, label, fetched_at) VALUES ('rel-1', 'XL Recordings', 0);",
        );
        crate::variants::recompute(&database.client, std::path::Path::new("/nonexistent"), std::path::Path::new("/nonexistent")).unwrap();
        let found = albums(&database.client).unwrap();
        assert_eq!(found.len(), 2);
        let album = &found[0];
        assert_eq!((album.name.as_str(), album.artist_name.as_str(), album.play_count), ("Self-titled", "Band", 3));
        assert_eq!(album.cover.as_deref(), Some("rel-1/7"));
        assert_eq!(album.detail["release_year"], json!(2001));
        assert_eq!(album.detail["tracks_heard"], json!(2));
        assert_eq!(album.detail["tracks"][0]["track"], json!("One"));
        assert_eq!(album.detail["tracks"][0]["plays"], json!(2));
        assert_eq!(album.detail["tracks"][0]["first_at"], json!(1_570_579_200));
        assert_eq!((&album.detail["release_type"], &album.detail["secondary_types"], &album.detail["label"]), (&json!("Album"), &json!("Live"), &json!("XL Recordings")));
        assert_eq!(album.detail["years"], json!([{ "year": 2019, "plays": 2 }, { "year": 2020, "plays": 1 }]));
        assert_ne!(found[0].slug, found[1].slug);
    }

    #[test]
    fn spellings_of_one_album_are_one_page_with_the_plays_of_all() {
        let database = TestDatabase::with(
            "INSERT INTO listens (listened_at, track_name, artist_name, release_name, recording_mbid) VALUES
               (1, 'One', 'Band', 'Album', NULL), (4, 'One', 'Band', 'Album', NULL), (2, 'One', 'Band', 'Album (Deluxe Edition)', NULL), (3, 'Bonus', 'Band', 'Album (Deluxe Edition)', NULL);",
        );
        crate::variants::recompute(&database.client, std::path::Path::new("/nonexistent"), std::path::Path::new("/nonexistent")).unwrap();
        let found = albums(&database.client).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!((found[0].name.as_str(), found[0].play_count), ("Album", 4));
        assert_eq!(found[0].detail["tracks"][0]["plays"], json!(3));
    }
}
