//! The artist pages: for each of the most played artists, totals, first and
//! last play, the albums and tracks that led, genres, plays per year and month, album release dates and the
//! longest run of days in a row with a play. One query per shape, the later
//! ones limited to the chosen artists.

use crate::artist_relations::{collaborations, similar, ArtistOfListen, Collaborator};
use crate::entities::{count, minutes, text, years_json, Entity};
use crate::scope::music_only;
use crate::slug::slug;
use anyhow::Result;
use chrono::NaiveDate;
use serde_json::{json, Value};
use shared_data::sqlite_client::SqliteClient;
use std::collections::HashMap;

const PROFILED_ARTISTS: i64 = 300;
// Two artists are listed as alike from this overlap of their genres up.
const MIN_SIMILARITY: f64 = 0.6;
// The artist's page lists albums only: the releases MusicBrainz types as an album (`album-types` asks it by the artist's and the album's name), but not a DJ mix, a demo or the spoken word.
// What is heard of every other release is «Andre» in the years chart.
const SQL_ALBUM_TYPES: &str = "SELECT artist_name, release_name FROM album_type WHERE primary_type = 'Album' \
     AND (',' || COALESCE(secondary_types, '') || ',') NOT LIKE '%,DJ-mix,%' AND (',' || COALESCE(secondary_types, '') || ',') NOT LIKE '%,Demo,%' \
     AND (',' || COALESCE(secondary_types, '') || ',') NOT LIKE '%,Spokenword,%' AND (',' || COALESCE(secondary_types, '') || ',') NOT LIKE '%,Interview,%' \
     AND (',' || COALESCE(secondary_types, '') || ',') NOT LIKE '%,Audiobook,%'";
// The newest releases are drawn as markers on the months chart; more would only crowd it.
const MAX_RELEASES: usize = 24;

const SQL_ARTISTS: &str = concat!(
    "SELECT artist_name, COUNT(*) AS plays, \
            SUM(COALESCE(listens.duration_ms, recording_metadata.length_ms, 210000)) AS listened_ms, \
            MIN(listened_at) AS first_at, MAX(listened_at) AS last_at, MAX(CASE WHEN listens.artist_mbid = recording_metadata.artist_mbid THEN recording_metadata.artist_area END) AS area, \
            MAX(artist_info.begin_year) AS begin_year, MAX(artist_info.end_year) AS end_year, MAX(artist_info.ended) AS ended, \
            MAX(CASE WHEN COALESCE(artist_spotify.image, artist_deezer.image, artist_info.image) IS NOT NULL THEN listens.artist_mbid END) AS image_mbid, \
            MAX(COALESCE(artist_spotify.image, artist_deezer.image, artist_info.image)) AS image \
     FROM canon_artist_listens AS listens LEFT JOIN recording_metadata USING (recording_mbid) \
          LEFT JOIN artist_info ON artist_info.artist_mbid = listens.artist_mbid \
          LEFT JOIN artist_deezer ON artist_deezer.artist_mbid = listens.artist_mbid \
          LEFT JOIN artist_spotify ON artist_spotify.artist_mbid = listens.artist_mbid WHERE ",
    music_only!(),
    " GROUP BY artist_name ORDER BY plays DESC, artist_name LIMIT ?"
);
// The artists are given as one JSON array, as `facts.rs` does for recordings.
const SQL_ITEMS: &str = concat!(
    "SELECT listens.artist_name, track_name, MAX(listens.album_name) AS release_name, COUNT(*) AS plays, MIN(listened_at) AS first_at, \
            MAX(CASE WHEN caa_release_mbid IS NOT NULL AND caa_id IS NOT NULL THEN caa_release_mbid || '/' || caa_id END) AS cover \
     FROM canon_artist_listens AS listens LEFT JOIN recording_metadata USING (recording_mbid) \
     WHERE listens.artist_name IN (SELECT value FROM json_each(?)) AND ",
    music_only!(),
    " GROUP BY listens.artist_name, track_name, listens.album_key"
);
// The listens that have more than one artist, one row for each.
const SQL_COLLABORATIONS: &str = concat!(
    "SELECT listened_at, track_name, credited_as, artist_name FROM \
       (SELECT listens.listened_at, listens.track_name, listens.credited_as, listens.artist_name, \
               COUNT(*) OVER (PARTITION BY listens.listened_at, listens.track_name, listens.credited_as) AS parts \
        FROM canon_artist_listens AS listens WHERE ",
    music_only!(),
    ") WHERE parts > 1"
);
const SQL_GENRES: &str = concat!(
    "SELECT artist_name, genre, COUNT(*) AS plays FROM canon_artist_listens AS listens JOIN recording_genres USING (recording_mbid) \
     WHERE artist_name IN (SELECT value FROM json_each(?)) AND ",
    music_only!(),
    " GROUP BY artist_name, genre"
);
const SQL_YEARS: &str = concat!(
    "SELECT artist_name, CAST(strftime('%Y', datetime(listened_at, 'unixepoch')) AS INTEGER) AS year, COUNT(*) AS plays \
     FROM canon_artist_listens AS listens WHERE artist_name IN (SELECT value FROM json_each(?)) AND ",
    music_only!(),
    " GROUP BY artist_name, year"
);
const SQL_ALBUM_YEARS: &str = concat!(
    "SELECT artist_name, album_name, CAST(strftime('%Y', datetime(listened_at, 'unixepoch')) AS INTEGER) AS year, COUNT(*) AS plays \
     FROM canon_artist_listens AS listens WHERE artist_name IN (SELECT value FROM json_each(?)) AND ",
    music_only!(),
    " GROUP BY artist_name, album_name, year"
);
const SQL_MONTHS: &str = concat!(
    "SELECT artist_name, strftime('%Y-%m', datetime(listened_at, 'unixepoch')) AS month, COUNT(*) AS plays \
     FROM canon_artist_listens AS listens WHERE artist_name IN (SELECT value FROM json_each(?)) AND ",
    music_only!(),
    " GROUP BY artist_name, month ORDER BY artist_name, month"
);
// The newest date an album's recordings first came out, as precise as MusicBrainz was: a whole date, else only the year.
const SQL_RELEASES: &str = concat!(
    "SELECT artist_name, album_name, MAX(COALESCE(recording_metadata.release_date, CAST(recording_metadata.release_year AS TEXT))) AS date \
     FROM canon_artist_listens AS listens JOIN recording_metadata USING (recording_mbid) \
     WHERE album_name IS NOT NULL AND artist_name IN (SELECT value FROM json_each(?)) AND ",
    music_only!(),
    " GROUP BY artist_name, album_name HAVING date IS NOT NULL ORDER BY artist_name, date, album_name"
);
const SQL_DAYS: &str = concat!(
    "SELECT DISTINCT artist_name, strftime('%Y-%m-%d', datetime(listened_at, 'unixepoch')) AS day \
     FROM canon_artist_listens AS listens WHERE artist_name IN (SELECT value FROM json_each(?)) AND ",
    music_only!(),
    " ORDER BY artist_name, day"
);

/// The longest run of consecutive days among `days` (sorted, distinct), and
/// the day it started on. An empty list is a run of nothing.
pub fn longest_run(days: &[NaiveDate]) -> (i64, Option<NaiveDate>) {
    let mut best = (0, None);
    let mut run = (0, None);
    let mut previous: Option<NaiveDate> = None;
    for day in days {
        run = match previous {
            Some(before) if before.succ_opt() == Some(*day) => (run.0 + 1, run.1),
            _ => (1, Some(*day)),
        };
        if run.0 > best.0 {
            best = run;
        }
        previous = Some(*day);
    }
    best
}

/// A track or an album of one artist: how often, and its cover where one is known.
#[derive(Debug, Clone, PartialEq)]
struct Item {
    name: String,
    plays: i64,
    cover: Option<String>,
}

/// The items of `parts` summed by name: plays added, the cover of the part with the most plays. Most played first, ties by name.
fn summed(parts: Vec<(String, i64, Option<String>)>) -> Vec<Item> {
    let mut by_name: HashMap<String, (i64, i64, Option<String>)> = HashMap::new();
    for (name, plays, cover) in parts {
        let entry = by_name.entry(name).or_insert((0, 0, None));
        entry.0 += plays;
        if cover.is_some() && (entry.2.is_none() || plays > entry.1) {
            entry.1 = plays;
            entry.2 = cover;
        }
    }
    let mut items: Vec<Item> = by_name.into_iter().map(|(name, (plays, _, cover))| Item { name, plays, cover }).collect();
    items.sort_by(|a, b| b.plays.cmp(&a.plays).then_with(|| a.name.cmp(&b.name)));
    items
}

fn items_json(items: &[Item], key: &str) -> Value {
    Value::Array(items.iter().map(|item| json!({ key: item.name, "plays": item.plays, "cover": item.cover })).collect())
}

/// The artists heard with, each with the tracks they share. The page links a name to its own page where it has one.
fn collaborations_json(list: Vec<Collaborator>) -> Value {
    Value::Array(
        list.into_iter()
            .map(|other| {
                let tracks: Vec<Value> = other.tracks.into_iter().map(|(track, plays)| json!({ "track": track, "plays": plays })).collect();
                json!({ "artist": other.artist, "plays": other.plays, "tracks": tracks })
            })
            .collect(),
    )
}

fn similar_json(list: Vec<(String, f64)>) -> Value {
    Value::Array(list.into_iter().map(|(other, score)| json!({ "artist": other, "score": (score * 100.0).round() / 100.0 })).collect())
}

/// Plays per year split by album: the `leading` albums each get their own lines, every other album (or none) is one line with a null album.
/// Oldest year first, the leading albums in their order, the rest last.
fn album_years_json(parts: Vec<(Option<String>, i64, i64)>, leading: &[Item]) -> Value {
    let mut cells: HashMap<(i64, Option<usize>), i64> = HashMap::new();
    for (album, year, plays) in parts {
        let segment = album.and_then(|name| leading.iter().position(|item| item.name == name));
        *cells.entry((year, segment)).or_insert(0) += plays;
    }
    let mut cells: Vec<_> = cells.into_iter().collect();
    cells.sort_by_key(|((year, segment), _)| (*year, segment.unwrap_or(usize::MAX)));
    Value::Array(cells.into_iter().map(|((year, segment), plays)| json!({ "album": segment.map(|index| &leading[index].name), "year": year, "plays": plays })).collect())
}

pub fn artists(db: &SqliteClient) -> Result<Vec<Entity>> {
    let top = db.query(SQL_ARTISTS, &[json!(PROFILED_ARTISTS)])?;
    let names = json!(Value::Array(top.iter().map(|artist| artist["artist_name"].clone()).collect()).to_string());

    let mut tracks: HashMap<String, Vec<(String, i64, Option<String>)>> = HashMap::new();
    let mut albums: HashMap<String, Vec<(String, i64, Option<String>)>> = HashMap::new();
    let mut firsts: HashMap<String, (i64, String)> = HashMap::new();
    // The releases MusicBrainz types as an album, by artist and name.
    let kinds: std::collections::HashSet<(String, String)> = db.query(SQL_ALBUM_TYPES, &[])?.iter().map(|row| (text(&row["artist_name"]), text(&row["release_name"]))).collect();
    for row in db.query(SQL_ITEMS, std::slice::from_ref(&names))? {
        let (artist, track, plays) = (text(&row["artist_name"]), text(&row["track_name"]), count(&row["plays"]));
        let cover = row["cover"].as_str().map(str::to_string);
        tracks.entry(artist.clone()).or_default().push((track.clone(), plays, cover.clone()));
        if let Some(album) = row["release_name"].as_str() {
            albums.entry(artist.clone()).or_default().push((album.to_string(), plays, cover));
        }
        let at = count(&row["first_at"]);
        let first = firsts.entry(artist).or_insert((at, track.clone()));
        if at < first.0 {
            *first = (at, track);
        }
    }
    let mut genres: HashMap<String, Vec<(String, i64)>> = HashMap::new();
    for row in db.query(SQL_GENRES, std::slice::from_ref(&names))? {
        genres.entry(text(&row["artist_name"])).or_default().push((text(&row["genre"]), count(&row["plays"])));
    }
    let credited: Vec<ArtistOfListen> = db
        .query(SQL_COLLABORATIONS, &[])?
        .iter()
        .map(|row| ArtistOfListen { listened_at: count(&row["listened_at"]), track: text(&row["track_name"]), credited_as: text(&row["credited_as"]), artist: text(&row["artist_name"]) })
        .collect();
    let mut collaborators = collaborations(&credited);
    let mut alike = similar(&genres, MIN_SIMILARITY);
    let mut years: HashMap<String, Vec<(i64, i64)>> = HashMap::new();
    for row in db.query(SQL_YEARS, std::slice::from_ref(&names))? {
        years.entry(text(&row["artist_name"])).or_default().push((count(&row["year"]), count(&row["plays"])));
    }
    let mut album_years: HashMap<String, Vec<(Option<String>, i64, i64)>> = HashMap::new();
    for row in db.query(SQL_ALBUM_YEARS, std::slice::from_ref(&names))? {
        album_years.entry(text(&row["artist_name"])).or_default().push((row["album_name"].as_str().map(str::to_string), count(&row["year"]), count(&row["plays"])));
    }
    let mut months: HashMap<String, Vec<Value>> = HashMap::new();
    for row in db.query(SQL_MONTHS, std::slice::from_ref(&names))? {
        months.entry(text(&row["artist_name"])).or_default().push(json!({ "month": row["month"], "plays": count(&row["plays"]) }));
    }
    let mut releases: HashMap<String, Vec<Value>> = HashMap::new();
    for row in db.query(SQL_RELEASES, std::slice::from_ref(&names))? {
        releases.entry(text(&row["artist_name"])).or_default().push(json!({ "album": row["album_name"], "date": row["date"] }));
    }
    let mut days: HashMap<String, Vec<NaiveDate>> = HashMap::new();
    for row in db.query(SQL_DAYS, std::slice::from_ref(&names))? {
        if let Ok(day) = NaiveDate::parse_from_str(&text(&row["day"]), "%Y-%m-%d") {
            days.entry(text(&row["artist_name"])).or_default().push(day);
        }
    }

    Ok(top
        .iter()
        .map(|artist| {
            let name = text(&artist["artist_name"]);
            let tracks = summed(tracks.remove(&name).unwrap_or_default());
            let albums: Vec<Item> = summed(albums.remove(&name).unwrap_or_default()).into_iter().filter(|item| kinds.contains(&(name.clone(), item.name.clone()))).collect();
            // The most played album's cover stands for the artist; else its most played track's.
            let cover = albums.iter().chain(tracks.iter()).find_map(|item| item.cover.clone());
            let mut genre_list = genres.remove(&name).unwrap_or_default();
            genre_list.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
            let genre_list: Vec<Value> = genre_list.into_iter().map(|(genre, plays)| json!({ "genre": genre, "plays": plays })).collect();
            let (streak_days, streak_start) = longest_run(&days.remove(&name).unwrap_or_default());
            let first_track = firsts.remove(&name).map(|(at, track)| json!({ "track": track, "at": at }));
            Entity {
                kind: "artist",
                slug: slug(&name),
                name,
                artist_name: String::new(),
                cover,
                play_count: count(&artist["plays"]),
                detail: json!({
                    "minutes": minutes(&artist["listened_ms"]),
                    "first_at": artist["first_at"],
                    "last_at": artist["last_at"],
                    "area": artist["area"],
                    "begin_year": artist["begin_year"],
                    "end_year": artist["end_year"],
                    "ended": artist["ended"].as_i64() == Some(1),
                    "image_mbid": artist["image_mbid"],
                    "image_source": artist["image"],
                    "years": years_json(years.remove(&text(&artist["artist_name"])).unwrap_or_default()),
                    "album_years": album_years_json(album_years.remove(&text(&artist["artist_name"])).unwrap_or_default(), &albums),
                    "months": months.remove(&text(&artist["artist_name"])).unwrap_or_default(),
                    "releases": releases.remove(&text(&artist["artist_name"])).map(|list| list[list.len().saturating_sub(MAX_RELEASES)..].to_vec()).unwrap_or_default(),
                    "streak_days": streak_days,
                    "streak_start": streak_start.map(|day| day.to_string()),
                    "top_tracks": items_json(&tracks, "track"),
                    "top_albums": items_json(&albums, "album"),
                    "genres": genre_list,
                    "collaborations": collaborations_json(collaborators.remove(&text(&artist["artist_name"])).unwrap_or_default()),
                    "similar": similar_json(alike.remove(&text(&artist["artist_name"])).unwrap_or_default()),
                    "first_track": first_track,
                }),
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entities::test_support::TestDatabase;

    fn day(text: &str) -> NaiveDate {
        NaiveDate::parse_from_str(text, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn the_longest_run_is_consecutive_days_and_remembers_where_it_began() {
        let days = [day("2020-02-27"), day("2020-02-28"), day("2020-02-29"), day("2020-03-01"), day("2020-03-05"), day("2020-03-06")];
        assert_eq!(longest_run(&days), (4, Some(day("2020-02-27"))));
        assert_eq!(longest_run(&[]), (0, None));
        assert_eq!(longest_run(&[day("2020-01-01")]), (1, Some(day("2020-01-01"))));
    }

    #[test]
    fn items_are_summed_by_name_with_the_cover_of_the_most_played_part() {
        let items = summed(vec![
            ("Album".into(), 2, Some("a/1".into())),
            ("Album".into(), 5, Some("b/2".into())),
            ("Album".into(), 9, None),
            ("Other".into(), 17, None),
        ]);
        assert_eq!(items[0], Item { name: "Other".into(), plays: 17, cover: None });
        assert_eq!(items[1], Item { name: "Album".into(), plays: 16, cover: Some("b/2".into()) });
    }

    #[test]
    fn years_split_by_the_leading_albums_with_the_rest_as_one() {
        let leading = [Item { name: "A".into(), plays: 5, cover: None }, Item { name: "B".into(), plays: 3, cover: None }];
        let parts = vec![(Some("B".into()), 2020, 3), (Some("C".into()), 2019, 1), (None, 2019, 2), (Some("A".into()), 2019, 4)];
        assert_eq!(
            album_years_json(parts, &leading),
            json!([
                { "album": "A", "year": 2019, "plays": 4 },
                { "album": null, "year": 2019, "plays": 3 },
                { "album": "B", "year": 2020, "plays": 3 },
            ])
        );
    }

    #[test]
    fn a_page_has_its_albums_tracks_genres_years_and_run_and_leaves_podcasts_out() {
        let database = TestDatabase::with(
            "INSERT INTO listens (listened_at, track_name, artist_name, release_name, recording_mbid) VALUES
               (1570579200, 'One', 'Band', 'First', 'r1'), (1570665600, 'Three', 'Band', 'First', 'r1'),
               (1602201600, 'Two', 'Band', 'Second', 'r2'), (1570579300, 'Headline', 'News', NULL, NULL);
             UPDATE listens SET duration_ms = 700000 WHERE artist_name = 'News';
             INSERT INTO recording_metadata (recording_mbid, release_year, release_date, artist_area, caa_release_mbid, caa_id, fetched_at)
               VALUES ('r1', 2001, NULL, 'Norway', 'rel-1', 7, 0), ('r2', 2010, '2010-03-05', 'Norway', NULL, NULL, 0);
             UPDATE recording_metadata SET artist_mbid = 'a1';
             INSERT INTO album_type (artist_name, release_name, primary_type, secondary_types, fetched_at) VALUES ('Band', 'First', 'Album', 'Live', 0), ('Band', 'Second', 'Single', NULL, 0);
             INSERT INTO artist_info (artist_mbid, begin_year, end_year, ended, image, fetched_at) VALUES ('a1', 1990, 2004, 1, 'https://commons.wikimedia.org/wiki/Special:FilePath/Band.jpg?width=400', 0);
             INSERT INTO recording_genres (recording_mbid, genre) VALUES ('r1', 'pop'), ('r2', 'pop'), ('r2', 'rock');",
        );
        crate::variants::recompute(&database.client, std::path::Path::new("/nonexistent"), std::path::Path::new("/nonexistent")).unwrap();
        let found = artists(&database.client).unwrap();
        assert_eq!(found.len(), 1);
        let band = &found[0];
        assert_eq!((band.name.as_str(), band.play_count), ("Band", 3));
        assert_eq!(band.cover.as_deref(), Some("rel-1/7"));
        assert_eq!(band.detail["area"], json!("Norway"));
        assert_eq!((&band.detail["begin_year"], &band.detail["end_year"], &band.detail["ended"]), (&json!(1990), &json!(2004), &json!(true)));
        assert_eq!((&band.detail["image_mbid"], &band.detail["image_source"]), (&json!("a1"), &json!("https://commons.wikimedia.org/wiki/Special:FilePath/Band.jpg?width=400")));
        assert_eq!(band.detail["streak_days"], json!(2));
        assert_eq!(band.detail["years"], json!([{ "year": 2019, "plays": 2 }, { "year": 2020, "plays": 1 }]));
        assert_eq!(band.detail["months"], json!([{ "month": "2019-10", "plays": 2 }, { "month": "2020-10", "plays": 1 }]));
        assert_eq!(band.detail["releases"], json!([{ "album": "First", "date": "2001" }, { "album": "Second", "date": "2010-03-05" }]));
        // «Second» is a single in MusicBrainz: not on the list of albums, and «Andre» in the years chart.
        assert_eq!(band.detail["album_years"], json!([{ "album": "First", "year": 2019, "plays": 2 }, { "album": null, "year": 2020, "plays": 1 }]));
        assert_eq!(band.detail["top_albums"].as_array().map(Vec::len), Some(1));
        assert_eq!(band.detail["top_albums"][0]["album"], json!("First"));
        assert_eq!(band.detail["top_tracks"][0]["track"], json!("One"));
        assert_eq!(band.detail["genres"][0], json!({ "genre": "pop", "plays": 3 }));
        assert_eq!(band.detail["first_track"]["track"], json!("One"));
    }
}
