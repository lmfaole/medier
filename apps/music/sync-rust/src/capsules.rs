//! A month in review for every month with plays: the top artists and tracks,
//! the artists first heard in it and the ones that went quiet after it,
//! written to `month_capsules`.
//!
//! One grouped read (a row per track and month), reduced in memory, like
//! `memories.rs`.

use shared_data::diff::{sync_table, Row, Table};
use crate::scope::music_only;
use anyhow::Result;
use serde_json::{json, Value};
use shared_data::sqlite_client::SqliteClient;
use std::collections::{BTreeMap, HashMap};

const LIST_LENGTH: usize = 5;
const TYPICAL_TRACK_MS: i64 = 210_000;
/// An artist heard less than this overall is not worth a farewell.
const MIN_PLAYS_TO_MISS: i64 = 15;
/// An artist has gone quiet when its last month is this many months before the newest data.
const QUIET_AFTER_MONTHS: i64 = 3;

const SQL_TRACKS_PER_MONTH: &str = concat!(
    "SELECT strftime('%Y-%m', datetime(listened_at, 'unixepoch')) AS month, \
            track_name, artist_name, COUNT(*) AS plays, \
            SUM(COALESCE(listens.duration_ms, recording_metadata.length_ms, 210000)) AS listened_ms, \
            MAX(CASE WHEN caa_release_mbid IS NOT NULL AND caa_id IS NOT NULL THEN caa_release_mbid || '/' || caa_id END) AS cover \
     FROM listens LEFT JOIN recording_metadata USING (recording_mbid) WHERE ",
    music_only!(),
    " GROUP BY month, track_name, artist_name"
);

const MONTH_CAPSULES: Table = Table {
    name: "month_capsules",
    columns: &["month", "play_count", "minutes", "top_artists", "top_tracks", "new_artists", "gone_quiet"],
    key_len: 1,
    compare_len: 7,
};

/// One track's plays in one month.
#[derive(Debug, Clone, PartialEq)]
pub struct TrackMonth {
    pub month: String,
    pub track: String,
    pub artist: String,
    pub plays: i64,
    pub listened_ms: i64,
    pub cover: Option<String>,
}

pub fn recompute_capsules(db: &SqliteClient) -> Result<usize> {
    let tracks: Vec<TrackMonth> = db
        .query(SQL_TRACKS_PER_MONTH, &[])?
        .iter()
        .map(|row| TrackMonth {
            month: row["month"].as_str().unwrap_or_default().to_string(),
            track: row["track_name"].as_str().unwrap_or_default().to_string(),
            artist: row["artist_name"].as_str().unwrap_or_default().to_string(),
            plays: row["plays"].as_i64().unwrap_or(0),
            listened_ms: row["listened_ms"].as_i64().unwrap_or(TYPICAL_TRACK_MS),
            cover: row["cover"].as_str().map(str::to_string),
        })
        .collect();
    let desired = capsule_rows(&tracks);
    let written = sync_table(db, &MONTH_CAPSULES, None, &desired)?;
    println!("wrote {written} of {} month capsules, the rest were unchanged", desired.len());
    Ok(desired.len())
}

/// Months since year 0, so two `YYYY-MM` can be subtracted.
fn month_number(month: &str) -> i64 {
    let year: i64 = month.get(..4).and_then(|year| year.parse().ok()).unwrap_or(0);
    let number: i64 = month.get(5..7).and_then(|number| number.parse().ok()).unwrap_or(0);
    year * 12 + number
}

/// `(name, plays)` pairs, most plays first, ties by name, cut to the list length.
fn ranked(plays: HashMap<&str, i64>) -> Vec<(&str, i64)> {
    let mut list: Vec<(&str, i64)> = plays.into_iter().collect();
    list.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
    list.truncate(LIST_LENGTH);
    list
}

fn artist_list(list: Vec<(&str, i64)>) -> Value {
    Value::Array(list.into_iter().map(|(artist, plays)| json!({ "artist": artist, "plays": plays })).collect())
}

/// A row of `month_capsules` per month in `tracks`, oldest first.
pub fn capsule_rows(tracks: &[TrackMonth]) -> Vec<Row> {
    let mut artist_totals: HashMap<&str, i64> = HashMap::new();
    let mut artist_months: HashMap<&str, (&str, &str)> = HashMap::new();
    let mut months: BTreeMap<&str, Vec<&TrackMonth>> = BTreeMap::new();
    for track in tracks {
        *artist_totals.entry(track.artist.as_str()).or_default() += track.plays;
        let span = artist_months.entry(track.artist.as_str()).or_insert((track.month.as_str(), track.month.as_str()));
        span.0 = span.0.min(track.month.as_str());
        span.1 = span.1.max(track.month.as_str());
        months.entry(track.month.as_str()).or_default().push(track);
    }
    let newest = months.keys().next_back().map_or(0, |month| month_number(month));

    months
        .into_iter()
        .map(|(month, mut in_month)| {
            let plays: i64 = in_month.iter().map(|track| track.plays).sum();
            let minutes: i64 = in_month.iter().map(|track| track.listened_ms).sum::<i64>() / 60_000;

            let mut month_plays: HashMap<&str, i64> = HashMap::new();
            for track in &in_month {
                *month_plays.entry(track.artist.as_str()).or_default() += track.plays;
            }
            let top_artists = artist_list(ranked(month_plays.clone()));
            let new_artists = artist_list(ranked(
                month_plays.keys().filter(|artist| artist_months[**artist].0 == month).map(|artist| (*artist, artist_totals[*artist])).collect(),
            ));
            let gone_quiet = artist_list(ranked(
                artist_months
                    .iter()
                    .filter(|(artist, span)| {
                        span.1 == month
                            && artist_totals[**artist] >= MIN_PLAYS_TO_MISS
                            && newest - month_number(month) >= QUIET_AFTER_MONTHS
                    })
                    .map(|(artist, _)| (*artist, artist_totals[*artist]))
                    .collect(),
            ));

            in_month.sort_by(|a, b| b.plays.cmp(&a.plays).then_with(|| a.track.cmp(&b.track)).then_with(|| a.artist.cmp(&b.artist)));
            let top_tracks: Vec<Value> = in_month
                .iter()
                .take(LIST_LENGTH)
                .map(|track| json!({ "track": track.track, "artist": track.artist, "plays": track.plays, "cover": track.cover }))
                .collect();
            vec![
                json!(month),
                json!(plays),
                json!(minutes),
                json!(top_artists.to_string()),
                json!(Value::Array(top_tracks).to_string()),
                json!(new_artists.to_string()),
                json!(gone_quiet.to_string()),
            ]
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(month: &str, name: &str, artist: &str, plays: i64) -> TrackMonth {
        TrackMonth { month: month.into(), track: name.into(), artist: artist.into(), plays, listened_ms: plays * 180_000, cover: None }
    }

    fn list(row: &Row, column: usize) -> Vec<(String, i64)> {
        let items: Vec<Value> = serde_json::from_str(row[column].as_str().unwrap()).unwrap();
        items.iter().map(|item| (item["artist"].as_str().unwrap().to_string(), item["plays"].as_i64().unwrap())).collect()
    }

    #[test]
    fn a_month_has_its_totals_and_top_artists() {
        let rows = capsule_rows(&[track("2020-01", "A", "Alpha", 3), track("2020-01", "B", "Beta", 5), track("2020-02", "A", "Alpha", 1)]);
        assert_eq!(rows.len(), 2);
        assert_eq!(&rows[0][..3], &[json!("2020-01"), json!(8), json!(24)]);
        assert_eq!(list(&rows[0], 3), vec![("Beta".to_string(), 5), ("Alpha".to_string(), 3)]);
    }

    #[test]
    fn an_artist_is_new_in_the_month_it_was_first_heard() {
        let rows = capsule_rows(&[track("2020-01", "A", "Alpha", 3), track("2020-02", "A", "Alpha", 1), track("2020-02", "B", "Beta", 2)]);
        assert_eq!(list(&rows[1], 5), vec![("Beta".to_string(), 2)]);
        assert_eq!(list(&rows[0], 5), vec![("Alpha".to_string(), 4)]);
    }

    #[test]
    fn an_artist_goes_quiet_after_the_last_month_only_when_loved_and_long_gone() {
        let rows = capsule_rows(&[
            track("2020-01", "A", "Loved", 20),
            track("2020-01", "B", "Passing", 2),
            track("2020-06", "C", "Still", 1),
        ]);
        assert_eq!(list(&rows[0], 6), vec![("Loved".to_string(), 20)]);
        let recent = capsule_rows(&[track("2020-05", "A", "Loved", 20), track("2020-06", "C", "Still", 1)]);
        assert!(list(&recent[0], 6).is_empty());
    }
}
