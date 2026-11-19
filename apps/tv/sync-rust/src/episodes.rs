//! The episodes of each series the log names. The register lists a series' episodes one season at a time, so each
//! season is fetched once (and the latest season of a series still in production again on a refresh, for the
//! episodes that came out since), landed unchanged under `.data/raw/tmdb/<date>/` and stored in `tv_episode`:
//! the name, the day it came out and how long it is.

use std::collections::BTreeSet;

use anyhow::{Context, Result};
use serde_json::{json, Value};
use shared_data::batch::insert_statements;
use shared_data::sqlite_client::SqliteClient;
use shared_data::tmdb::{self, Client, Refresh};

use crate::tmdb::REGISTER;

#[derive(Debug, PartialEq, Eq)]
pub struct Episode {
    pub number: i64,
    pub name: Option<String>,
    pub air_date: Option<String>,
    pub runtime_min: Option<i64>,
}

/// The episodes of a season's answer.
pub fn parse_season(answer: &Value) -> Vec<Episode> {
    answer["episodes"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|episode| {
            Some(Episode {
                number: tmdb::positive(&episode["episode_number"])?,
                name: tmdb::text(&episode["name"]),
                air_date: tmdb::text(&episode["air_date"]),
                runtime_min: tmdb::positive(&episode["runtime"]),
            })
        })
        .collect()
}

/// (series, number of seasons, still in production)
type Series = (i64, i64, bool);

/// The (series, season) pairs to fetch: those with no episodes stored, and on a refresh the latest season of a series in
/// production, where new episodes come.
#[must_use]
pub fn seasons_due(series: &[Series], stored: &BTreeSet<(i64, i64)>, refresh: Refresh) -> Vec<(i64, i64)> {
    let mut due = Vec::new();
    for &(id, seasons, in_production) in series {
        for season in 1..=seasons {
            let latest = in_production && season == seasons;
            if refresh == Refresh::Everything || !stored.contains(&(id, season)) || (refresh == Refresh::Changed && latest) {
                due.push((id, season));
            }
        }
    }
    due
}

/// Replaces the stored episodes of one season.
pub fn store_season(db: &SqliteClient, series: i64, season: i64, episodes: &[Episode], now: i64) -> Result<()> {
    let mut batch: Vec<(String, Vec<Value>)> = vec![("DELETE FROM tv_episode WHERE tmdb_id = ? AND season = ?".to_string(), vec![json!(series), json!(season)])];
    batch.extend(insert_statements(
        "INSERT OR REPLACE INTO",
        "tv_episode",
        &["tmdb_id", "season", "episode", "name", "air_date", "runtime_min", "fetched_at"],
        episodes.iter().map(|episode| vec![json!(series), json!(season), json!(episode.number), json!(episode.name), json!(episode.air_date), json!(episode.runtime_min), json!(now)]),
    ));
    db.execute_batch(&batch).with_context(|| format!("storing season {season} of {series}"))
}

fn series_of_the_log(db: &SqliteClient) -> Result<Vec<Series>> {
    let ids = tmdb::wanted(db, &REGISTER, true)?;
    let rows = db.query("SELECT tmdb_id, number_of_seasons, in_production FROM tv_title", &[])?;
    Ok(rows.iter().filter_map(|row| Some((row["tmdb_id"].as_i64()?, row["number_of_seasons"].as_i64()?, row["in_production"].as_i64()? == 1))).filter(|(id, ..)| ids.contains(id)).collect())
}

fn stored_seasons(db: &SqliteClient) -> Result<BTreeSet<(i64, i64)>> {
    let rows = db.query("SELECT DISTINCT tmdb_id, season FROM tv_episode", &[])?;
    Ok(rows.iter().filter_map(|row| Some((row["tmdb_id"].as_i64()?, row["season"].as_i64()?))).collect())
}

/// Fetches, lands and stores each of the seasons; returns how many.
pub fn fetch(db: &SqliteClient, client: &Client, seasons: &[(i64, i64)]) -> Result<usize> {
    let directory = shared_data::raw::landing_path("tmdb", chrono::Utc::now().date_naive())?;
    std::fs::create_dir_all(&directory).with_context(|| format!("creating {}", directory.display()))?;
    let now = chrono::Utc::now().timestamp();
    for &(series, season) in seasons {
        let answer = client.get(&format!("/tv/{series}/season/{season}"), &[("language", "nb-NO")])?;
        tmdb::land(&directory.join(format!("tv-{series}-season-{season}.json")), &answer)?;
        store_season(db, series, season, &parse_season(&answer), now)?;
    }
    Ok(seasons.len())
}

/// The seasons due for the log's series, fetched and stored.
pub fn run(db: &SqliteClient, refresh: Refresh) -> Result<()> {
    let due = seasons_due(&series_of_the_log(db)?, &stored_seasons(db)?, refresh);
    let count = if due.is_empty() { 0 } else { fetch(db, &Client::new("tv-sync/0.1 (+https://sky.lmfaole.party/apps/medier/tv)")?, &due)? };
    println!("episodes: {count} seasons fetched");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_season_has_its_episodes_with_the_day_and_the_length_where_the_register_has_them() {
        let answer = json!({"episodes": [
            {"episode_number": 1, "name": "Pilot", "air_date": "2024-02-23", "runtime": 44},
            {"episode_number": 2, "name": "", "air_date": null, "runtime": 0}
        ]});
        assert_eq!(
            parse_season(&answer),
            vec![
                Episode { number: 1, name: Some("Pilot".into()), air_date: Some("2024-02-23".into()), runtime_min: Some(44) },
                Episode { number: 2, name: None, air_date: None, runtime_min: None },
            ]
        );
    }

    #[test]
    fn a_season_is_fetched_once_and_the_latest_of_a_running_series_again_on_a_refresh() {
        let series = [(1, 2, true), (2, 2, false)];
        let stored: BTreeSet<(i64, i64)> = [(1, 1), (1, 2), (2, 1)].into_iter().collect();
        assert_eq!(seasons_due(&series, &stored, Refresh::No), vec![(2, 2)]);
        assert_eq!(seasons_due(&series, &stored, Refresh::Changed), vec![(1, 2), (2, 2)]);
        assert_eq!(seasons_due(&series, &stored, Refresh::Everything).len(), 4);
    }
}
