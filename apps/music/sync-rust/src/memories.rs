//! "On this day": for every calendar day and every year with plays on it, how
//! much was heard, the top artist and the top tracks, written to
//! `day_memories`. The Worker reads one calendar day across the years.
//!
//! One grouped read of `listens` (a row per track and day, not per play), then
//! the reduction in memory, so the SQL stays simple and the choice of "top" is
//! a tested function.

use shared_data::diff::{sync_table, Row, Table};
use crate::scope::music_only;
use anyhow::Result;
use serde_json::{json, Value};
use shared_data::sqlite_client::SqliteClient;
use std::collections::BTreeMap;

const TOP_TRACKS: usize = 3;
const TYPICAL_TRACK_MS: i64 = 210_000;

// The cover is the track's own, `<release>/<id>` as `top_item_covers` has it.
const SQL_TRACKS_PER_DAY: &str = concat!(
    "SELECT strftime('%m-%d', datetime(listened_at, 'unixepoch')) AS month_day, \
            CAST(strftime('%Y', datetime(listened_at, 'unixepoch')) AS INTEGER) AS year, \
            track_name, artist_name, COUNT(*) AS plays, \
            SUM(COALESCE(listens.duration_ms, recording_metadata.length_ms, 210000)) AS listened_ms, \
            MAX(CASE WHEN caa_release_mbid IS NOT NULL AND caa_id IS NOT NULL THEN caa_release_mbid || '/' || caa_id END) AS cover \
     FROM listens LEFT JOIN recording_metadata USING (recording_mbid) WHERE ",
    music_only!(),
    " GROUP BY month_day, year, track_name, artist_name"
);

const DAY_MEMORIES: Table = Table {
    name: "day_memories",
    columns: &["month_day", "year", "play_count", "minutes", "top_artist", "top_tracks"],
    key_len: 2,
    compare_len: 6,
};

/// One track's plays on one calendar day of one year.
#[derive(Debug, Clone, PartialEq)]
pub struct TrackDay {
    pub month_day: String,
    pub year: i64,
    pub track: String,
    pub artist: String,
    pub plays: i64,
    pub listened_ms: i64,
    pub cover: Option<String>,
}

pub fn recompute_memories(db: &SqliteClient) -> Result<usize> {
    let tracks: Vec<TrackDay> = db
        .query(SQL_TRACKS_PER_DAY, &[])?
        .iter()
        .map(|row| TrackDay {
            month_day: row["month_day"].as_str().unwrap_or_default().to_string(),
            year: row["year"].as_i64().unwrap_or(0),
            track: row["track_name"].as_str().unwrap_or_default().to_string(),
            artist: row["artist_name"].as_str().unwrap_or_default().to_string(),
            plays: row["plays"].as_i64().unwrap_or(0),
            listened_ms: row["listened_ms"].as_i64().unwrap_or(TYPICAL_TRACK_MS),
            cover: row["cover"].as_str().map(str::to_string),
        })
        .collect();
    let desired = memory_rows(&tracks);
    let written = sync_table(db, &DAY_MEMORIES, None, &desired)?;
    println!("wrote {written} of {} day memories, the rest were unchanged", desired.len());
    Ok(desired.len())
}

/// A row of `day_memories` for each calendar day and year in `tracks`, ordered by day, then year.
pub fn memory_rows(tracks: &[TrackDay]) -> Vec<Row> {
    let mut days: BTreeMap<(&str, i64), Vec<&TrackDay>> = BTreeMap::new();
    for track in tracks {
        days.entry((track.month_day.as_str(), track.year)).or_default().push(track);
    }
    days.into_iter()
        .map(|((month_day, year), mut day)| {
            let plays: i64 = day.iter().map(|track| track.plays).sum();
            let minutes: i64 = day.iter().map(|track| track.listened_ms).sum::<i64>() / 60_000;
            let top_artist = top_artist(&day);
            day.sort_by(|a, b| b.plays.cmp(&a.plays).then_with(|| a.track.cmp(&b.track)).then_with(|| a.artist.cmp(&b.artist)));
            let top_tracks: Vec<Value> = day
                .iter()
                .take(TOP_TRACKS)
                .map(|track| json!({ "track": track.track, "artist": track.artist, "plays": track.plays, "cover": track.cover }))
                .collect();
            vec![json!(month_day), json!(year), json!(plays), json!(minutes), json!(top_artist), json!(Value::Array(top_tracks).to_string())]
        })
        .collect()
}

/// The artist with the most plays that day; a tie goes to the first by name.
fn top_artist(day: &[&TrackDay]) -> String {
    let mut plays: BTreeMap<&str, i64> = BTreeMap::new();
    for track in day {
        *plays.entry(track.artist.as_str()).or_default() += track.plays;
    }
    plays.into_iter().max_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.cmp(a.0))).map(|(artist, _)| artist.to_string()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn track(month_day: &str, year: i64, name: &str, artist: &str, plays: i64) -> TrackDay {
        TrackDay { month_day: month_day.into(), year, track: name.into(), artist: artist.into(), plays, listened_ms: plays * 180_000, cover: None }
    }

    #[test]
    fn a_row_per_day_and_year_with_the_most_played_tracks_first() {
        let rows = memory_rows(&[
            track("10-09", 2019, "B", "Beta", 1),
            track("10-09", 2019, "A", "Alpha", 3),
            track("10-09", 2019, "C", "Beta", 1),
            track("10-09", 2019, "D", "Delta", 1),
            track("10-09", 2020, "A", "Alpha", 1),
        ]);
        assert_eq!(rows.len(), 2);
        assert_eq!(&rows[0][..5], &[json!("10-09"), json!(2019), json!(6), json!(18), json!("Alpha")]);
        let tops: Vec<Value> = serde_json::from_str(rows[0][5].as_str().unwrap()).unwrap();
        let names: Vec<&str> = tops.iter().map(|top| top["track"].as_str().unwrap()).collect();
        assert_eq!(names, ["A", "B", "C"]);
        assert_eq!(rows[1][1], json!(2020));
    }

    #[test]
    fn an_artist_tie_goes_to_the_first_by_name() {
        let rows = memory_rows(&[track("01-01", 2022, "X", "Zed", 2), track("01-01", 2022, "Y", "Abe", 2)]);
        assert_eq!(rows[0][4], json!("Abe"));
    }

    #[test]
    fn the_query_groups_music_by_calendar_day_and_year_and_leaves_podcasts_out() {
        let connection = Connection::open_in_memory().unwrap();
        for statement in crate::schema::statements(crate::schema::SCHEMA) {
            connection.execute(&statement, []).unwrap();
        }
        connection
            .execute_batch(
                "INSERT INTO listens (listened_at, track_name, artist_name, release_name) VALUES
                   (1570579200, 'Song', 'Band', 'Album'),
                   (1570582800, 'Song', 'Band', 'Album'),
                   (1602201600, 'Song', 'Band', 'Album'),
                   (1570579300, 'Headline', 'News', NULL);
                 UPDATE listens SET duration_ms = 700000 WHERE artist_name = 'News';",
            )
            .unwrap();
        let mut statement = connection.prepare(SQL_TRACKS_PER_DAY).unwrap();
        let mut found: Vec<(String, i64, i64)> = statement
            .query_map([], |row| Ok((row.get("month_day")?, row.get("year")?, row.get("plays")?)))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        found.sort();
        assert_eq!(found, vec![("10-09".to_string(), 2019, 2), ("10-09".to_string(), 2020, 1)]);
    }
}
