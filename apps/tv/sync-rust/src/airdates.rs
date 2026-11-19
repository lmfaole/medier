//! `air-dates <tmdb_id>`: moves a series' viewings in the log to the day each episode came out, for a series that was
//! watched as it aired but logged in one go. The days are the stored episodes (`episodes.rs`, fetched first), the
//! log is copied to `<log>.before-air-dates` first (never over an existing copy), and an episode the register has no
//! day for keeps the day the log gave it.

use std::collections::{BTreeSet, HashMap};
use std::path::Path;

use anyhow::{bail, Context, Result};
use shared_data::sqlite_client::SqliteClient;
use shared_data::tmdb::Client;
use shared_data::watch_log::Watch;

use crate::episodes;
use crate::log::LOG;

/// The day each stored episode of a series came out, by (season, episode).
fn stored_days(db: &SqliteClient, series: i64) -> Result<HashMap<(i64, i64), String>> {
    let rows = db.query("SELECT season, episode, air_date FROM tv_episode WHERE tmdb_id = ? AND air_date IS NOT NULL", &[serde_json::json!(series)])?;
    Ok(rows.iter().filter_map(|row| Some(((row["season"].as_i64()?, row["episode"].as_i64()?), row["air_date"].as_str()?.to_string()))).collect())
}

/// Gives each viewing of the series its episode's day; returns how many changed.
fn move_to_air_dates(watches: &mut [Watch], series: i64, days: &HashMap<(i64, i64), String>) -> usize {
    let mut changed = 0;
    for watch in watches.iter_mut().filter(|watch| watch.tmdb_id == Some(series)) {
        let (Some(season), Some(episode)) = (watch.season, watch.episode) else { continue };
        if let Some(day) = days.get(&(season, episode)) {
            if watch.watched_on.as_ref() != Some(day) {
                watch.watched_on = Some(day.clone());
                changed += 1;
            }
        }
    }
    changed
}

/// The log's text with the comment lines it began with, the header and then each viewing.
/// Writes `watches` as the log, after copying the log to `<log>.<suffix>`; never over an existing copy. Returns the copy's path.
pub fn rewrite_log(path: &Path, suffix: &str, text: &str, watches: &[Watch]) -> Result<std::path::PathBuf> {
    let backup = path.with_extension(format!("csv.{suffix}"));
    if backup.exists() {
        bail!("{} already exists: look at it and move it away before running this again", backup.display());
    }
    std::fs::copy(path, &backup).with_context(|| format!("copying the log to {}", backup.display()))?;
    std::fs::write(path, written(text, watches)?).with_context(|| format!("writing {}", path.display()))?;
    Ok(backup)
}

fn written(text: &str, watches: &[Watch]) -> Result<String> {
    let mut out: String = text.lines().take_while(|line| line.starts_with('#')).flat_map(|line| [line, "\n"]).collect();
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(LOG.header)?;
    for watch in watches {
        writer.write_record(LOG.line(watch)?)?;
    }
    out.push_str(&String::from_utf8(writer.into_inner().context("finishing the tv log")?)?);
    Ok(out)
}

pub fn run(db: &SqliteClient, path: &Path, series: i64) -> Result<()> {
    let text = LOG.read_file(path)?;
    let mut watches = LOG.read(&text)?;
    let seasons: BTreeSet<i64> = watches.iter().filter(|watch| watch.tmdb_id == Some(series)).filter_map(|watch| watch.season).collect();
    if seasons.is_empty() {
        bail!("the tv log has no episode with the TMDB number {series}");
    }
    let wanted: Vec<(i64, i64)> = seasons.iter().map(|season| (series, *season)).collect();
    episodes::fetch(db, &Client::new("tv-sync")?, &wanted)?;
    let changed = move_to_air_dates(&mut watches, series, &stored_days(db, series)?);
    let backup = rewrite_log(path, "before-air-dates", &text, &watches)?;
    let count = LOG.import(db, path)?;
    println!("air-dates: {changed} viewings moved to the day they came out; {count} viewings in all (the old log is {})", backup.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn watch(season: i64, episode: i64, tmdb_id: i64) -> Watch {
        Watch { watched_on: Some("2026-10-20".into()), title: "Spillet".into(), season: Some(season), episode: Some(episode), tmdb_id: Some(tmdb_id), ..Watch::default() }
    }

    #[test]
    fn an_episode_takes_its_air_day_and_one_the_register_has_no_day_for_keeps_the_logged_one() {
        let days: HashMap<(i64, i64), String> = [((1, 1), "2024-02-23".to_string())].into_iter().collect();
        let mut watches = vec![watch(1, 1, 7), watch(1, 2, 7), watch(1, 1, 8)];
        assert_eq!(move_to_air_dates(&mut watches, 7, &days), 1);
        let days_of: Vec<_> = watches.iter().map(|watch| watch.watched_on.clone().unwrap_or_default()).collect();
        assert_eq!(days_of, ["2024-02-23", "2026-10-20", "2026-10-20"]);
    }

    #[test]
    fn the_rewritten_log_keeps_its_comment_lines_and_reads_back_the_same() {
        let text = "# a comment\nwatched_on,series,year,season,episode,rating,rewatch,note,tmdb_id\n2026-10-20,Spillet,2024,1,1,,,,7\n";
        let watches = LOG.read(text).unwrap();
        assert_eq!(written(text, &watches).unwrap(), text);
    }
}
