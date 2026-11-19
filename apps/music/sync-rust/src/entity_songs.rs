//! The song pages: for each of the most played songs (a track name and its
//! artist), totals, the album and year, genres, plays per year, when in the
//! day it is played, its busiest day and the artist's other songs.

use crate::entities::{count, minutes, text, years_json, Entity};
use crate::scope::music_only;
use crate::slug::slug_of;
use anyhow::Result;
use serde_json::{json, Value};
use shared_data::sqlite_client::SqliteClient;
use std::collections::HashMap;

const PROFILED_SONGS: i64 = 500;
const SIBLINGS: usize = 5;
const TOP_GENRES: usize = 5;

const SQL_SONGS: &str = concat!(
    "SELECT track_name, listens.artist_name AS artist_name, COUNT(*) AS plays, \
            SUM(COALESCE(listens.duration_ms, recording_metadata.length_ms, 210000)) AS listened_ms, \
            MIN(listened_at) AS first_at, MAX(listened_at) AS last_at, MAX(recording_metadata.release_year) AS release_year, \
            MIN(listens.album_name) AS album, \
            MAX(CASE WHEN caa_release_mbid IS NOT NULL AND caa_id IS NOT NULL THEN caa_release_mbid || '/' || caa_id END) AS cover, \
           MAX(release_group_info.primary_type) AS release_type, MAX(release_group_info.secondary_types) AS secondary_types, MAX(release_label.label) AS label \
     FROM canon_listens AS listens LEFT JOIN recording_metadata USING (recording_mbid) \
          LEFT JOIN release_group_info ON release_group_info.release_group_mbid = recording_metadata.release_group_mbid \
          LEFT JOIN release_label ON release_label.release_mbid = recording_metadata.caa_release_mbid WHERE ",
    music_only!(),
    " GROUP BY track_name, listens.artist_name ORDER BY plays DESC, track_name, listens.artist_name LIMIT ?"
);
// The songs are given as one JSON array of [track, artist] pairs.
const SONGS_IN: &str = "(track_name, artist_name) IN (SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?))";
const SQL_YEARS: &str = concat!(
    "SELECT track_name, artist_name, CAST(strftime('%Y', datetime(listened_at, 'unixepoch')) AS INTEGER) AS bucket, COUNT(*) AS plays \
     FROM canon_listens AS listens WHERE (track_name, artist_name) IN (SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?)) AND ",
    music_only!(),
    " GROUP BY track_name, artist_name, bucket"
);
const SQL_HOURS: &str = concat!(
    "SELECT track_name, artist_name, CAST(strftime('%H', datetime(listened_at, 'unixepoch')) AS INTEGER) AS bucket, COUNT(*) AS plays \
     FROM canon_listens AS listens WHERE (track_name, artist_name) IN (SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?)) AND ",
    music_only!(),
    " GROUP BY track_name, artist_name, bucket"
);
const SQL_DAYS: &str = concat!(
    "SELECT track_name, artist_name, strftime('%Y-%m-%d', datetime(listened_at, 'unixepoch')) AS day, COUNT(*) AS plays \
     FROM canon_listens AS listens WHERE (track_name, artist_name) IN (SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?)) AND ",
    music_only!(),
    " GROUP BY track_name, artist_name, day"
);
const SQL_GENRES: &str = concat!(
    "SELECT track_name, artist_name, genre, COUNT(*) AS plays FROM canon_listens AS listens JOIN recording_genres USING (recording_mbid) \
     WHERE (track_name, artist_name) IN (SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?)) AND ",
    music_only!(),
    " GROUP BY track_name, artist_name, genre"
);

type Key = (String, String);

fn key(row: &Value) -> Key {
    (text(&row["track_name"]), text(&row["artist_name"]))
}

/// The day with the most plays among `(day, plays)`; a tie goes to the earlier day.
fn busiest_day(days: &[(String, i64)]) -> Option<(String, i64)> {
    days.iter().max_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.cmp(&a.0))).cloned()
}

pub fn songs(db: &SqliteClient) -> Result<Vec<Entity>> {
    let top = db.query(SQL_SONGS, &[json!(PROFILED_SONGS)])?;
    let pairs = json!(Value::Array(top.iter().map(|song| json!([song["track_name"], song["artist_name"]])).collect()).to_string());
    debug_assert!(SONGS_IN.contains("json_each"));

    let mut years: HashMap<Key, Vec<(i64, i64)>> = HashMap::new();
    for row in db.query(SQL_YEARS, std::slice::from_ref(&pairs))? {
        years.entry(key(&row)).or_default().push((count(&row["bucket"]), count(&row["plays"])));
    }
    let mut hours: HashMap<Key, [i64; 24]> = HashMap::new();
    for row in db.query(SQL_HOURS, std::slice::from_ref(&pairs))? {
        if let Ok(hour) = usize::try_from(count(&row["bucket"])) {
            if let Some(slot) = hours.entry(key(&row)).or_insert([0; 24]).get_mut(hour) {
                *slot = count(&row["plays"]);
            }
        }
    }
    let mut days: HashMap<Key, Vec<(String, i64)>> = HashMap::new();
    for row in db.query(SQL_DAYS, std::slice::from_ref(&pairs))? {
        days.entry(key(&row)).or_default().push((text(&row["day"]), count(&row["plays"])));
    }
    let mut genres: HashMap<Key, Vec<(String, i64)>> = HashMap::new();
    for row in db.query(SQL_GENRES, std::slice::from_ref(&pairs))? {
        genres.entry(key(&row)).or_default().push((text(&row["genre"]), count(&row["plays"])));
    }

    // The artist's other songs among those profiled: most played first, as `top` is ordered.
    let mut by_artist: HashMap<String, Vec<(String, i64)>> = HashMap::new();
    for song in &top {
        by_artist.entry(text(&song["artist_name"])).or_default().push((text(&song["track_name"]), count(&song["plays"])));
    }

    Ok(top
        .iter()
        .map(|song| {
            let key = key(song);
            let mut genre_list = genres.remove(&key).unwrap_or_default();
            genre_list.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
            let genre_list: Vec<Value> = genre_list.into_iter().take(TOP_GENRES).map(|(genre, plays)| json!({ "genre": genre, "plays": plays })).collect();
            let busiest = busiest_day(&days.remove(&key).unwrap_or_default()).map(|(day, plays)| json!({ "day": day, "plays": plays }));
            let siblings: Vec<Value> = by_artist
                .get(&key.1)
                .into_iter()
                .flatten()
                .filter(|(track, _)| *track != key.0)
                .take(SIBLINGS)
                .map(|(track, plays)| json!({ "track": track, "plays": plays }))
                .collect();
            Entity {
                kind: "song",
                slug: slug_of(&[&key.0, &key.1]),
                name: key.0.clone(),
                artist_name: key.1.clone(),
                cover: song["cover"].as_str().map(str::to_string),
                play_count: count(&song["plays"]),
                detail: json!({
                    "minutes": minutes(&song["listened_ms"]),
                    "first_at": song["first_at"],
                    "last_at": song["last_at"],
                    "release_type": song["release_type"],
                    "secondary_types": song["secondary_types"],
                    "label": song["label"],
                    "release_year": song["release_year"],
                    "album": song["album"],
                    "years": years_json(years.remove(&key).unwrap_or_default()),
                    "hours": hours.remove(&key).unwrap_or([0; 24]),
                    "busiest_day": busiest,
                    "genres": genre_list,
                    "siblings": siblings,
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
    fn the_busiest_day_is_the_one_with_most_plays_and_the_earlier_on_a_tie() {
        let days = [("2020-01-02".to_string(), 3), ("2020-01-01".to_string(), 3), ("2020-01-03".to_string(), 1)];
        assert_eq!(busiest_day(&days), Some(("2020-01-01".to_string(), 3)));
        assert_eq!(busiest_day(&[]), None);
    }

    #[test]
    fn a_song_has_its_album_year_hours_busiest_day_and_the_artists_other_songs() {
        let database = TestDatabase::with(
            "INSERT INTO listens (listened_at, track_name, artist_name, release_name, recording_mbid) VALUES
               (1570579200, 'One', 'Band', 'Album', 'r1'), (1570582800, 'One', 'Band', 'Album', 'r1'), (1602201600, 'One', 'Band', 'Album', 'r1'),
               (1602201700, 'Two', 'Band', 'Album', 'r2'), (1602201800, 'Podcast', 'News', NULL, NULL);
             UPDATE listens SET duration_ms = 700000 WHERE artist_name = 'News';
             INSERT INTO recording_metadata (recording_mbid, release_year, caa_release_mbid, caa_id, fetched_at)
               VALUES ('r1', 2001, 'rel-1', 7, 0), ('r2', 2001, NULL, NULL, 0);
             INSERT INTO recording_genres (recording_mbid, genre) VALUES ('r1', 'pop');",
        );
        crate::variants::recompute(&database.client, std::path::Path::new("/nonexistent"), std::path::Path::new("/nonexistent")).unwrap();
        let found = songs(&database.client).unwrap();
        assert_eq!(found.len(), 2);
        let one = &found[0];
        assert_eq!((one.name.as_str(), one.artist_name.as_str(), one.play_count), ("One", "Band", 3));
        assert_eq!(one.detail["album"], json!("Album"));
        assert_eq!(one.detail["release_year"], json!(2001));
        assert_eq!(one.detail["hours"][0], json!(2));
        assert_eq!(one.detail["hours"][1], json!(1));
        assert_eq!(one.detail["busiest_day"], json!({ "day": "2019-10-09", "plays": 2 }));
        assert_eq!(one.detail["genres"][0], json!({ "genre": "pop", "plays": 3 }));
        assert_eq!(one.detail["siblings"], json!([{ "track": "Two", "plays": 1 }]));
        assert_eq!(one.cover.as_deref(), Some("rel-1/7"));
    }

    #[test]
    fn spellings_of_one_song_and_artist_are_one_page_with_the_plays_of_all() {
        let database = TestDatabase::with(
            "INSERT INTO listens (listened_at, track_name, artist_name, release_name, recording_mbid) VALUES
               (1, 'Die a Little Bit', 'Tinashe', 'Album', NULL), (2, 'Die a Little Bit', 'Tinashe', 'Album', NULL),
               (3, 'Die A Little Bit', 'tinashe', 'Album', NULL), (4, 'Die A Little Bit (Live)', 'Tinashe', 'Album', NULL);",
        );
        crate::variants::recompute(&database.client, std::path::Path::new("/nonexistent"), std::path::Path::new("/nonexistent")).unwrap();
        let found = songs(&database.client).unwrap();
        assert_eq!(found.len(), 2);
        assert_eq!((found[0].name.as_str(), found[0].artist_name.as_str(), found[0].play_count), ("Die a Little Bit", "Tinashe", 3));
    }
}
