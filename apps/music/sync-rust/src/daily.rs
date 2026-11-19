//! The two day-level tables, `daily_plays` and `daily_listening_time`, and the
//! all-time numbers that only need them. Cheap enough to refresh daily while the
//! rest of `all` is recomputed weekly.

use crate::scope::music_only;
use anyhow::Result;
use chrono::{DateTime, NaiveDate};
use serde_json::json;
use shared_data::diff::{sync_table_since, Row, Table};
use shared_data::sqlite_client::SqliteClient;
use shared_data::window::{current_years, year_start, Target};
use std::collections::HashSet;

use crate::aggregate::streaks;

// The listening time is `MINUTES`' expression in milliseconds, so days add up exactly.
pub(crate) const SQL_DAILY_PLAYS_SINCE: &str = concat!(
    "SELECT strftime('%Y-%m-%d', datetime(listened_at, 'unixepoch')) AS day, \
            COUNT(*) AS play_count, \
            SUM(COALESCE(listens.duration_ms, recording_metadata.length_ms, 210000)) AS listened_ms \
     FROM listens LEFT JOIN recording_metadata USING (recording_mbid) \
     WHERE listened_at >= ? AND ",
    music_only!(),
    " GROUP BY day ORDER BY day"
);

const DAILY_PLAYS: Table = Table { name: "daily_plays", columns: &["day", "play_count"], key_len: 1, compare_len: 2 };
const DAILY_LISTENING_TIME: Table =
    Table { name: "daily_listening_time", columns: &["day", "listened_ms"], key_len: 1, compare_len: 2 };
/// The first second `recompute_daily_plays` reads listens from: the years new
/// listens can still land in for `current-year`, everything for the rest.
fn daily_plays_since(target: Target, today: NaiveDate) -> i64 {
    match target {
        Target::CurrentYear => current_years(today).first().map_or(0, |year| year_start(*year)),
        Target::Rolling | Target::Years | Target::All => 0,
    }
}

/// Brings `daily_plays` and `daily_listening_time` up to date from `target`'s
/// start on, writing only the days that are new or changed: a day's worth of
/// listens writes a row or two, and the rest of the tables are neither read
/// nor touched. A day that has no listening time yet is a new row, so
/// `daily-plays all` backfills it.
pub fn recompute_daily_plays(db: &SqliteClient, target: Target) -> Result<()> {
    let since = daily_plays_since(target, chrono::Utc::now().date_naive());
    let first_day = DateTime::from_timestamp(since, 0).unwrap_or_default().format("%Y-%m-%d").to_string();
    let days = db.query(SQL_DAILY_PLAYS_SINCE, &[json!(since)])?;
    let plays: Vec<Row> = days.iter().map(|row| vec![row["day"].clone(), row["play_count"].clone()]).collect();
    let time: Vec<Row> = days.iter().map(|row| vec![row["day"].clone(), row["listened_ms"].clone()]).collect();
    sync_table_since(db, &DAILY_PLAYS, "day", &json!(first_day), &plays)?;
    sync_table_since(db, &DAILY_LISTENING_TIME, "day", &json!(first_day), &time).map(|_| ())
}

// `listened_ms` is NULL for a day that has no listening time row yet.
const SQL_ALL_DAYS: &str = "SELECT daily_plays.day AS day, play_count, listened_ms \
     FROM daily_plays LEFT JOIN daily_listening_time USING (day) ORDER BY day";
// A NULL minutes keeps what the row has, rather than writing a partial total.
const SQL_UPDATE_TOTALS: &str = "UPDATE summary_periods \
     SET total_listens = ?, total_minutes = COALESCE(?, total_minutes), \
         longest_streak_days = ?, current_streak_days = ? WHERE period_key = 'all'";

/// One day of `daily_plays`, with its listening time once it has a row.
struct Day {
    date: NaiveDate,
    plays: i64,
    listened_ms: Option<i64>,
}

#[derive(Debug, PartialEq)]
struct AllTimeTotals {
    listens: i64,
    /// `None` until every day has a listening time: a total over some of the days is wrong.
    minutes: Option<i64>,
    longest_streak: i64,
    current_streak: i64,
}

fn all_time_totals(days: &[Day], today: NaiveDate) -> AllTimeTotals {
    let listened: HashSet<NaiveDate> = days.iter().map(|day| day.date).collect();
    let (longest_streak, current_streak) = streaks(&listened, today);
    let times: Option<Vec<i64>> = days.iter().map(|day| day.listened_ms).collect();
    AllTimeTotals {
        listens: days.iter().map(|day| day.plays).sum(),
        minutes: times.filter(|times| !times.is_empty()).map(|times| times.iter().sum::<i64>() / 60_000),
        longest_streak,
        current_streak,
    }
}

/// Refreshes the numbers of `all` that only need the daily tables (about a
/// thousand rows each) instead of the listens, so they stay current while the
/// rest of `all` is recomputed weekly: a streak that is days old reads as a bug.
pub fn refresh_all_time_totals(db: &SqliteClient) -> Result<()> {
    let days: Vec<Day> = db
        .query(SQL_ALL_DAYS, &[])?
        .iter()
        .filter_map(|row| {
            Some(Day {
                date: NaiveDate::parse_from_str(row["day"].as_str()?, "%Y-%m-%d").ok()?,
                plays: row["play_count"].as_i64()?,
                listened_ms: row["listened_ms"].as_i64(),
            })
        })
        .collect();
    let totals = all_time_totals(&days, chrono::Utc::now().date_naive());
    db.execute_batch(&[(
        SQL_UPDATE_TOTALS.to_string(),
        vec![json!(totals.listens), json!(totals.minutes), json!(totals.longest_streak), json!(totals.current_streak)],
    )])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::fixture_database as database;
    use rusqlite::Connection;

    fn daily_plays_since(connection: &Connection, since: i64) -> Vec<(String, i64)> {
        let mut statement = connection.prepare(SQL_DAILY_PLAYS_SINCE).unwrap();
        statement
            .query_map([since], |row| Ok((row.get("day")?, row.get("play_count")?)))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    #[test]
    fn daily_plays_group_listens_by_utc_day() {
        let connection = database();
        connection
            .execute("INSERT INTO listens (listened_at, track_name, artist_name) VALUES (1704070800, 'Late', 'Someone')", [])
            .unwrap();
        assert_eq!(
            daily_plays_since(&connection, 0),
            vec![("2024-01-01".to_string(), 2), ("2024-02-01".to_string(), 1), ("2024-03-01".to_string(), 1)]
        );
    }

    #[test]
    fn daily_plays_since_a_moment_leave_the_earlier_days_out() {
        let connection = database();
        assert_eq!(
            daily_plays_since(&connection, 1_706_745_600),
            vec![("2024-02-01".to_string(), 1), ("2024-03-01".to_string(), 1)]
        );
    }

    #[test]
    fn only_the_current_year_job_reads_part_of_the_history() {
        let today = NaiveDate::from_ymd_opt(2026, 10, 7).unwrap();
        assert_eq!(super::daily_plays_since(Target::CurrentYear, today), year_start(2026));
        assert_eq!(super::daily_plays_since(Target::All, today), 0);
    }

    #[test]
    fn all_time_totals_add_the_days_up_and_find_the_streaks() {
        let date = |d| NaiveDate::from_ymd_opt(2026, 3, d).unwrap();
        let day = |d, plays, listened_ms| Day { date: date(d), plays, listened_ms };
        let days = [day(1, 4, Some(600_000)), day(2, 1, Some(300_000)), day(3, 2, Some(150_000)), day(7, 5, Some(0)), day(8, 1, Some(90_000))];
        let totals = all_time_totals(&days, date(8));
        assert_eq!(
            totals,
            AllTimeTotals { listens: 13, minutes: Some(19), longest_streak: 3, current_streak: 2 }
        );
    }

    #[test]
    fn minutes_wait_until_every_day_has_a_listening_time() {
        let date = |d| NaiveDate::from_ymd_opt(2026, 3, d).unwrap();
        let days = [Day { date: date(1), plays: 4, listened_ms: Some(600_000) }, Day { date: date(2), plays: 1, listened_ms: None }];
        assert_eq!(all_time_totals(&days, date(2)).minutes, None);
        assert_eq!(all_time_totals(&[], date(2)).minutes, None);
    }

    #[test]
    fn daily_listening_time_is_the_listens_duration_else_the_recordings_else_a_typical_track() {
        let connection = database();
        let mut statement = connection.prepare(SQL_DAILY_PLAYS_SINCE).unwrap();
        let ms: Vec<i64> = statement
            .query_map([0], |row| row.get("listened_ms"))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        // 2024-01-01: no duration, the recording's 360000; 2024-02-01: its own 120000; 2024-03-01: the 210000 default.
        assert_eq!(ms, vec![360_000, 120_000, 210_000]);
    }
}
