//! Recomputes the wrapped-style summary tables from the raw `listens` table.
//! Each job recomputes the periods of one `Target`, so the Worker only ever
//! does cheap, precomputed reads — see `docs/ARCHITECTURE.md` for why that split exists.

use crate::scope::MUSIC_ONLY;
use shared_data::batch::insert_statements;
use shared_data::window::{current_years, year_start, Target};
use shared_data::sqlite_client::SqliteClient;
use anyhow::Result;
use chrono::{Duration, NaiveDate};
use serde_json::{json, Value};
use std::collections::HashSet;

/// Every listen, with its recording's metadata where there is any. A
/// `LEFT JOIN` on the metadata's primary key, so it never adds or drops a
/// listen.
/// Plays under the one name each artist, track and album has (`canon_listens`), so a spelling never counts as another entry.
const LISTENS: &str = "canon_listens AS listens LEFT JOIN recording_metadata USING (recording_mbid)";
/// The same with one row for each artist of a listen, so a collaboration counts for every artist on it; only artists are ranked and counted from it.
const ARTIST_LISTENS: &str = "canon_artist_listens AS listens LEFT JOIN recording_metadata USING (recording_mbid)";

/// Minutes listened: the listen's own duration, else the recording's length
/// from MusicBrainz, else a typical track length.
const MINUTES: &str = "SUM(COALESCE(listens.duration_ms, recording_metadata.length_ms, 210000)) / 60000";

const BREAKDOWN_TOP_LIMIT: i64 = 15;

// Statements stay under 100 bound parameters: 20 rows * 5 columns.

/// The SELECT behind each `breakdowns` dimension, given a period's WHERE
/// clause. Each yields `label`, `play_count` and `minutes`.
fn breakdown_query(dimension: &str, where_clause: &str) -> String {
    match dimension {
        "genre" => format!(
            "SELECT recording_genres.genre AS label, COUNT(*) AS play_count, {MINUTES} AS minutes \
             FROM {LISTENS} JOIN recording_genres USING (recording_mbid) \
             WHERE {where_clause} \
             GROUP BY label ORDER BY play_count DESC, label LIMIT {BREAKDOWN_TOP_LIMIT}"
        ),
        "decade" => format!(
            "SELECT (recording_metadata.release_year / 10 * 10) || 's' AS label, COUNT(*) AS play_count, {MINUTES} AS minutes \
             FROM {LISTENS} \
             WHERE {where_clause} AND recording_metadata.release_year IS NOT NULL \
             GROUP BY label ORDER BY label"
        ),
        "area" => format!(
            "SELECT recording_metadata.artist_area AS label, COUNT(*) AS play_count, {MINUTES} AS minutes \
             FROM {LISTENS} \
             WHERE {where_clause} AND recording_metadata.artist_area IS NOT NULL \
             GROUP BY label ORDER BY play_count DESC, label LIMIT {BREAKDOWN_TOP_LIMIT}"
        ),
        "month" => format!(
            "SELECT strftime('%Y-%m', datetime(listened_at, 'unixepoch')) AS label, COUNT(*) AS play_count, {MINUTES} AS minutes \
             FROM {LISTENS} \
             WHERE {where_clause} \
             GROUP BY label ORDER BY label"
        ),
        other => unreachable!("no breakdown query for dimension {other}"),
    }
}

/// Headline numbers for a period. A recording ListenBrainz knows always has
/// an artist, so `artist_mbid` is what "has metadata" means here.
fn totals_query(where_clause: &str) -> String {
    format!(
        "SELECT COUNT(*) AS total_listens, \
                {MINUTES} AS total_minutes, \
                (SELECT COUNT(DISTINCT artist_name) FROM {ARTIST_LISTENS} WHERE {where_clause}) AS unique_artists, \
                COUNT(DISTINCT track_name || '::' || artist_name) AS unique_tracks, \
                COUNT(recording_metadata.artist_mbid) AS listens_with_metadata \
         FROM {LISTENS} WHERE {where_clause}"
    )
}

const BREAKDOWN_DIMENSIONS: [&str; 4] = ["genre", "decade", "area", "month"];

/// Entries per category in `top_items`. The Charts page shows them all.
const TOP_LIMIT: i64 = 25;

/// The rolling windows the Charts page offers next to whole years, as
/// (period key, days). Their key says how they are computed, so the Worker
/// and the frontend can list them without querying the database.
const ROLLING_WINDOWS: [(&str, i64); 4] = [
    ("last-7-days", 7),
    ("last-30-days", 30),
    ("last-90-days", 90),
    ("last-365-days", 365),
];

/// "all", a four-digit year, or one of `ROLLING_WINDOWS`. A rolling window
/// only gets top lists: its summary and breakdowns would cost reads
/// reads for numbers no page shows.
struct Period {
    key: String,
    where_clause: String,
    charts_only: bool,
}

/// Recomputes the summary tables of the periods `target` names; every other
/// period's rows are left as they are.
pub fn recompute(db: &SqliteClient, target: Target) -> Result<()> {
    let today = chrono::Utc::now().date_naive();
    let periods = match target {
        Target::All => vec![Period { key: "all".to_string(), where_clause: MUSIC_ONLY.to_string(), charts_only: false }],
        Target::Rolling => {
            let now = chrono::Utc::now().timestamp();
            ROLLING_WINDOWS
                .iter()
                .map(|(key, days)| Period {
                    key: (*key).to_string(),
                    where_clause: format!("listened_at >= {} AND {MUSIC_ONLY}", now - days * 86_400),
                    charts_only: true,
                })
                .collect()
        }
        Target::Years => distinct_years(db)?.into_iter().map(year_period).collect(),
        Target::CurrentYear => {
            let mut years = Vec::new();
            for year in current_years(today) {
                if has_listens_in(db, year)? {
                    years.push(year_period(year));
                }
            }
            years
        }
    };

    for period in &periods {
        if period.charts_only {
            recompute_top_items(db, period)?;
        } else {
            recompute_period(db, period)?;
        }
    }
    Ok(())
}

fn year_period(year: i32) -> Period {
    Period { key: year.to_string(), where_clause: year_where_clause(year), charts_only: false }
}

/// A year in progress with no listen yet has nothing to summarize.
fn has_listens_in(db: &SqliteClient, year: i32) -> Result<bool> {
    let rows = db.query(&format!("SELECT 1 FROM listens WHERE {} LIMIT 1", year_where_clause(year)), &[])?;
    Ok(!rows.is_empty())
}

/// A year as a `listened_at` range rather than `strftime(...) = year`, so
/// SQLite can use `idx_listens_time` instead of reading every listen.
fn year_where_clause(year: i32) -> String {
    format!("listened_at >= {} AND listened_at < {} AND {MUSIC_ONLY}", year_start(year), year_start(year + 1))
}

fn distinct_years(db: &SqliteClient) -> Result<Vec<i32>> {
    let rows = db.query(
        &format!(
            "SELECT DISTINCT strftime('%Y', datetime(listened_at, 'unixepoch')) AS year \
             FROM listens WHERE {MUSIC_ONLY} ORDER BY year"
        ),
        &[],
    )?;
    Ok(rows
        .into_iter()
        .filter_map(|row| row["year"].as_str().and_then(|year| year.parse().ok()))
        .collect())
}

const SQL_DELETE_SUMMARY: &str = "DELETE FROM summary_periods WHERE period_key = ?";
const SQL_INSERT_SUMMARY: &str = "INSERT INTO summary_periods \
     (period_key, total_listens, total_minutes, unique_artists, unique_tracks, \
      top_artist_name, top_track_name, top_track_artist, \
      longest_streak_days, current_streak_days, computed_at) \
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
const SQL_UPSERT_COVERAGE: &str = "INSERT OR REPLACE INTO metadata_coverage \
     (period_key, total_listens, listens_with_metadata) VALUES (?, ?, ?)";

fn recompute_period(db: &SqliteClient, period: &Period) -> Result<()> {
    let where_clause = &period.where_clause;

    let totals = db.query(&totals_query(where_clause), &[])?;
    let totals = totals.first().cloned().unwrap_or(Value::Null);

    let (top_artists, top_tracks) = recompute_top_items(db, period)?;

    let (longest_streak_days, current_streak_days) = compute_streaks(db, where_clause)?;

    let top_artist_name = top_artists.first().and_then(|row| row["name"].as_str());
    let top_track_name = top_tracks.first().and_then(|row| row["name"].as_str());
    let top_track_artist = top_tracks
        .first()
        .and_then(|row| row["secondary_name"].as_str());

    // One batch, so a failure part-way never leaves the period deleted but not yet rewritten.
    let mut statements: Vec<(String, Vec<Value>)> = vec![
        (SQL_DELETE_SUMMARY.to_string(), vec![json!(period.key)]),
        (
            SQL_INSERT_SUMMARY.to_string(),
            vec![
                json!(period.key),
                totals["total_listens"].clone(),
                totals["total_minutes"].clone(),
                totals["unique_artists"].clone(),
                totals["unique_tracks"].clone(),
                json!(top_artist_name),
                json!(top_track_name),
                json!(top_track_artist),
                json!(longest_streak_days),
                json!(current_streak_days),
                json!(chrono::Utc::now().timestamp()),
            ],
        ),
    ];
    statements.push((
        SQL_UPSERT_COVERAGE.to_string(),
        vec![
            json!(period.key),
            totals["total_listens"].clone(),
            totals["listens_with_metadata"].clone(),
        ],
    ));
    db.execute_batch(&statements)?;

    write_breakdowns(db, period)?;

    Ok(())
}

/// Rewrites a period's top artists, tracks and albums, and returns the
/// first two, which the period's summary row names its top entries from.
fn recompute_top_items(db: &SqliteClient, period: &Period) -> Result<(Vec<Value>, Vec<Value>)> {
    let where_clause = &period.where_clause;
    let top_artists = top_rows(db, where_clause, "artist_name AS name, NULL AS secondary_name", "artist_name", ARTIST_LISTENS)?;
    let top_tracks = top_rows(
        db,
        where_clause,
        "track_name AS name, artist_name AS secondary_name",
        "track_name, artist_name",
        LISTENS,
    )?;
    let top_albums = top_rows(
        db,
        &format!("{where_clause} AND listens.album_key IS NOT NULL"),
        "MAX(album_name) AS name, MAX(album_artist) AS secondary_name",
        "album_key",
        LISTENS,
    )?;

    db.execute_batch(&[
        ("DELETE FROM top_items WHERE period_key = ?".to_string(), vec![json!(period.key)]),
        ("DELETE FROM top_item_covers WHERE period_key = ?".to_string(), vec![json!(period.key)]),
    ])?;
    write_top_items(db, &period.key, "artist", &top_artists)?;
    write_top_items(db, &period.key, "track", &top_tracks)?;
    write_top_items(db, &period.key, "album", &top_albums)?;

    Ok((top_artists, top_tracks))
}

fn write_breakdowns(db: &SqliteClient, period: &Period) -> Result<()> {
    let mut rows: Vec<(&str, Value)> = Vec::new();
    for dimension in BREAKDOWN_DIMENSIONS {
        for row in db.query(&breakdown_query(dimension, &period.where_clause), &[])? {
            rows.push((dimension, row));
        }
    }

    let mut statements = vec![(
        "DELETE FROM breakdowns WHERE period_key = ?".to_string(),
        vec![json!(period.key)],
    )];
    let breakdowns = rows.iter().map(|(dimension, row)| {
        vec![json!(period.key), json!(dimension), row["label"].clone(), row["play_count"].clone(), row["minutes"].clone()]
    });
    statements.extend(insert_statements(
        "INSERT INTO",
        "breakdowns",
        &["period_key", "dimension", "label", "play_count", "minutes"],
        breakdowns,
    ));
    db.execute_batch(&statements)
}

fn top_rows(
    db: &SqliteClient,
    where_clause: &str,
    select_names: &str,
    group_by: &str,
    from: &str,
) -> Result<Vec<Value>> {
    db.query(&top_rows_query(where_clause, select_names, group_by, from), &[])
}

/// The top `TOP_LIMIT` for a period. `cover` is one Cover Art Archive cover among the
/// group's listens, as "`<caa_release_mbid>/<caa_id>`": for a track or an
/// album that is almost always its one release, for an artist any one of
/// theirs. `MAX` over the joined string keeps the MBID and ID from the same
/// row, which two separate `MAX`es would not.
fn top_rows_query(where_clause: &str, select_names: &str, group_by: &str, from: &str) -> String {
    format!(
        "SELECT {select_names}, COUNT(*) AS play_count, {MINUTES} AS minutes, \
                MAX(recording_metadata.caa_release_mbid || '/' || recording_metadata.caa_id) AS cover \
         FROM {from} WHERE {where_clause} \
         GROUP BY {group_by} ORDER BY play_count DESC, name LIMIT {TOP_LIMIT}"
    )
}

/// Writes one category's top rows and their covers in a single transaction
/// trip, instead of one request per row.
fn write_top_items(db: &SqliteClient, period_key: &str, category: &str, rows: &[Value]) -> Result<()> {
    let mut statements: Vec<(String, Vec<Value>)> = Vec::new();
    for (index, row) in rows.iter().enumerate() {
        let rank = json!(index + 1);
        statements.push((
            "INSERT INTO top_items \
             (period_key, category, rank, name, secondary_name, play_count, minutes) \
             VALUES (?, ?, ?, ?, ?, ?, ?)"
                .to_string(),
            vec![
                json!(period_key),
                json!(category),
                rank.clone(),
                row["name"].clone(),
                row["secondary_name"].clone(),
                row["play_count"].clone(),
                row["minutes"].clone(),
            ],
        ));
        if !row["cover"].is_null() {
            statements.push((
                "INSERT INTO top_item_covers (period_key, category, rank, cover) VALUES (?, ?, ?, ?)".to_string(),
                vec![json!(period_key), json!(category), rank, row["cover"].clone()],
            ));
        }
    }
    db.execute_batch(&statements)
}

/// Longest and current run of consecutive calendar days with at least one
/// listen. Pulling the distinct days and walking them in Rust is simpler and
/// clearer than a recursive SQL query for something this small.
fn compute_streaks(db: &SqliteClient, where_clause: &str) -> Result<(i64, i64)> {
    let rows = db.query(
        &format!(
            "SELECT DISTINCT date(listened_at, 'unixepoch') AS day \
             FROM listens WHERE {where_clause} ORDER BY day"
        ),
        &[],
    )?;

    let days: HashSet<NaiveDate> = rows
        .iter()
        .filter_map(|row| row["day"].as_str())
        .filter_map(|day| NaiveDate::parse_from_str(day, "%Y-%m-%d").ok())
        .collect();

    Ok(streaks(&days, chrono::Utc::now().date_naive()))
}

/// Longest and current run of consecutive days in `days`. A run that ended
/// yesterday is still current, since no listen yet today does not break it.
pub(crate) fn streaks(days: &HashSet<NaiveDate>, today: NaiveDate) -> (i64, i64) {
    if days.is_empty() {
        return (0, 0);
    }

    let mut sorted: Vec<NaiveDate> = days.iter().copied().collect();
    sorted.sort();

    let mut longest = 1i64;
    let mut running = 1i64;
    for pair in sorted.windows(2) {
        if pair[1] == pair[0] + Duration::days(1) {
            running += 1;
        } else {
            running = 1;
        }
        longest = longest.max(running);
    }

    let mut current = 0i64;
    let mut cursor = today;
    loop {
        if days.contains(&cursor) {
            current += 1;
            cursor -= Duration::days(1);
        } else if cursor == today {
            cursor -= Duration::days(1);
        } else {
            break;
        }
    }

    (longest, current)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    use crate::daily::SQL_DAILY_PLAYS_SINCE;
    use crate::schema::fixture_database as database;

    fn rows(connection: &Connection, sql: &str) -> Vec<(String, i64, i64)> {
        let mut statement = connection.prepare(sql).unwrap();
        statement
            .query_map([], |row| Ok((row.get("label")?, row.get("play_count")?, row.get("minutes")?)))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    #[test]
    fn totals_fall_back_from_listen_duration_to_recording_length_to_a_typical_track() {
        let connection = database();
        let (total_minutes, with_metadata): (i64, i64) = connection
            .query_row(&totals_query("1 = 1"), [], |row| {
                Ok((row.get("total_minutes")?, row.get("listens_with_metadata")?))
            })
            .unwrap();
        // 360000 (recording length) + 120000 (own duration) + 210000 (typical) ms.
        assert_eq!(total_minutes, 11);
        assert_eq!(with_metadata, 2);
    }

    #[test]
    fn genre_counts_a_listen_once_per_genre_of_its_recording() {
        let connection = database();
        assert_eq!(
            rows(&connection, &breakdown_query("genre", "1 = 1")),
            vec![("electronic".to_string(), 2, 8), ("synth-pop".to_string(), 2, 8)]
        );
    }

    #[test]
    fn decade_and_area_leave_out_listens_without_metadata() {
        let connection = database();
        assert_eq!(rows(&connection, &breakdown_query("decade", "1 = 1")), vec![("1990s".to_string(), 2, 8)]);
        assert_eq!(rows(&connection, &breakdown_query("area", "1 = 1")), vec![("Norway".to_string(), 2, 8)]);
    }

    #[test]
    fn top_rows_carry_a_cover_only_where_one_is_known() {
        let connection = database();
        let sql = top_rows_query("1 = 1", "track_name AS name, artist_name AS secondary_name", "track_name, artist_name", LISTENS);
        let mut statement = connection.prepare(&sql).unwrap();
        let covers: Vec<(String, Option<String>)> = statement
            .query_map([], |row| Ok((row.get("name")?, row.get("cover")?)))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(
            covers,
            vec![
                ("Some Resolve".to_string(), Some("release-1/42".to_string())),
                ("Unmapped".to_string(), None),
            ]
        );
    }

    #[test]
    fn a_year_is_a_listened_at_range_covering_exactly_that_year() {
        assert_eq!(
            year_where_clause(2026),
            format!("listened_at >= 1767225600 AND listened_at < 1798761600 AND {MUSIC_ONLY}")
        );
        let connection = database();
        let in_2024 = rows(&connection, &breakdown_query("month", &year_where_clause(2024)));
        assert_eq!(in_2024.len(), 3);
        assert_eq!(rows(&connection, &breakdown_query("month", &year_where_clause(2025))), []);
    }

    #[test]
    fn month_includes_every_listen_and_respects_the_period() {
        let connection = database();
        assert_eq!(
            rows(&connection, &breakdown_query("month", "1 = 1")),
            vec![
                ("2024-01".to_string(), 1, 6),
                ("2024-02".to_string(), 1, 2),
                ("2024-03".to_string(), 1, 3),
            ]
        );
        let year_2023 = "strftime('%Y', datetime(listened_at, 'unixepoch')) = '2023'";
        assert_eq!(rows(&connection, &breakdown_query("month", year_2023)), []);
    }

    #[test]
    fn a_clip_is_left_out_of_every_summary_but_stays_in_listens() {
        let connection = database();
        connection
            .execute_batch(
                "INSERT INTO listens (listened_at, track_name, artist_name, duration_ms) VALUES (1709337600, 'Episode', 'Debatten', 3000000);",
            )
            .unwrap();
        let count = |sql: &str| -> i64 { connection.query_row(sql, [], |row| row.get(0)).unwrap() };
        assert_eq!(count("SELECT COUNT(*) FROM listens"), 4);
        let (plays, minutes): (i64, i64) = connection
            .query_row(&totals_query(MUSIC_ONLY), [], |row| Ok((row.get("total_listens")?, row.get("total_minutes")?)))
            .unwrap();
        assert_eq!(plays, 3, "the episode is not a music play");
        assert!(minutes < 50, "its fifty minutes are not music minutes: {minutes}");
        assert_eq!(count(&format!("SELECT COUNT(*) FROM listens WHERE {}", year_where_clause(2024))), 3);
        let mut statement = connection.prepare(SQL_DAILY_PLAYS_SINCE).unwrap();
        let days = statement.query_map([0], |row| row.get::<_, String>("day")).unwrap().count();
        assert_eq!(days, 3, "no day of its own for the episode");
    }
}
