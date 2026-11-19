//! `expand`: a series the log has as a whole («I have seen it», a line with no season and episode) becomes a line for each
//! episode that has come out, on the day it came out, from the stored episodes (`episodes.rs`; run `tmdb` first). A series
//! with no stored episodes yet is left as it is. The log is copied to `<log>.before-expand-<time>` first.

use std::collections::{BTreeMap, HashSet};
use std::path::Path;

use anyhow::Result;
use shared_data::sqlite_client::SqliteClient;
use shared_data::watch_log::Watch;

use crate::airdates::rewrite_log;
use crate::log::LOG;

/// One aired episode: (season, episode, day).
pub type Aired = (i64, i64, String);

/// The log with each whole-series line replaced by a line per aired episode it lacks. `aired` is by series number and
/// `matched` gives the number of a line without one; a series with no aired episodes keeps its line. Returns how many
/// lines it made.
pub fn expand(watches: &mut Vec<Watch>, matched: impl Fn(&Watch) -> Option<i64>, aired: &BTreeMap<i64, Vec<Aired>>) -> usize {
    let have: HashSet<(i64, i64, i64)> = watches.iter().filter_map(|w| Some((w.tmdb_id?, w.season?, w.episode?))).collect();
    let mut made = Vec::new();
    watches.retain(|watch| {
        if watch.season.is_some() || watch.episode.is_some() {
            return true;
        }
        let Some(id) = watch.tmdb_id.or_else(|| matched(watch)) else { return true };
        let Some(episodes) = aired.get(&id).filter(|episodes| !episodes.is_empty()) else { return true };
        for (season, episode, day) in episodes {
            if !have.contains(&(id, *season, *episode)) {
                made.push(Watch { watched_on: Some(day.clone()), title: watch.title.clone(), year: watch.year, season: Some(*season), episode: Some(*episode), rewatch: watch.rewatch, tmdb_id: Some(id), ..Watch::default() });
            }
        }
        false
    });
    let count = made.len();
    watches.extend(made);
    count
}

pub fn run(db: &SqliteClient, path: &Path) -> Result<()> {
    let text = LOG.read_file(path)?;
    let mut watches = LOG.read(&text)?;
    let today = chrono::Utc::now().date_naive().to_string();
    let mut aired: BTreeMap<i64, Vec<Aired>> = BTreeMap::new();
    for row in db.query("SELECT tmdb_id, season, episode, air_date FROM tv_episode WHERE air_date IS NOT NULL ORDER BY tmdb_id, season, episode", &[])? {
        if let (Some(id), Some(season), Some(episode), Some(day)) = (row["tmdb_id"].as_i64(), row["season"].as_i64(), row["episode"].as_i64(), row["air_date"].as_str()) {
            if day <= today.as_str() {
                aired.entry(id).or_default().push((season, episode, day.to_string()));
            }
        }
    }
    let numbers: BTreeMap<(String, i64), i64> = db
        .query("SELECT title, year, tmdb_id FROM tv_match WHERE tmdb_id IS NOT NULL", &[])?
        .iter()
        .filter_map(|row| Some(((row["title"].as_str()?.to_string(), row["year"].as_i64()?), row["tmdb_id"].as_i64()?)))
        .collect();
    let made = expand(&mut watches, |watch| numbers.get(&(watch.title.clone(), watch.year.unwrap_or(0))).copied(), &aired);
    if made == 0 {
        println!("expand: nothing to expand");
        return Ok(());
    }
    let backup = rewrite_log(path, &format!("before-expand-{}", chrono::Utc::now().format("%Y%m%d-%H%M%S")), &text, &watches)?;
    let count = LOG.import(db, path)?;
    println!("expand: {made} episode lines made; {count} viewings in all (the old log is {})", backup.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn whole(title: &str, id: Option<i64>) -> Watch {
        Watch { title: title.into(), year: Some(2020), tmdb_id: id, ..Watch::default() }
    }

    #[test]
    fn a_whole_series_becomes_its_aired_episodes_and_keeps_what_the_log_already_has() {
        let mut watches = vec![whole("Dark", Some(7)), Watch { watched_on: Some("2024-01-01".into()), title: "Dark".into(), season: Some(1), episode: Some(1), tmdb_id: Some(7), ..Watch::default() }, whole("Unknown", Some(9)), whole("Matched", None)];
        let aired: BTreeMap<i64, Vec<Aired>> = [(7, vec![(1, 1, "2017-12-01".to_string()), (1, 2, "2017-12-08".to_string())]), (8, vec![(1, 1, "2020-01-01".to_string())])].into_iter().collect();
        let made = expand(&mut watches, |watch| (watch.title == "Matched").then_some(8), &aired);
        assert_eq!(made, 2);
        assert_eq!(watches.iter().filter(|w| w.episode.is_none()).map(|w| w.title.as_str()).collect::<Vec<_>>(), vec!["Unknown"]);
        let dark: Vec<_> = watches.iter().filter(|w| w.tmdb_id == Some(7)).map(|w| (w.episode, w.watched_on.as_deref().unwrap_or_default())).collect();
        assert_eq!(dark, vec![(Some(1), "2024-01-01"), (Some(2), "2017-12-08")]);
    }
}
