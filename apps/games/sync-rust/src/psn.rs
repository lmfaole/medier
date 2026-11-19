//! `PlayStation`, where the owner's console games are: `games-sync psn` adds what the account's data report (Sony's
//! "request your data") says. The report is not asked for from here: the Nextcloud repository
//! (`NEXTCLOUD_DIR`, else `~/Dokumenter/nextcloud`) turns the zip into `export/playstation-games.json`
//! (`playstation-import.ts`, by hand when a new report comes) and this reads it. Every game bought or claimed is `owned`
//! in the collection (format `playstation`); one with hours is also a `playing` line of the log, with the hours of each
//! day the report counts. A line is added once, by its `source` (`psn:<title>:<day>`), so the
//! owner's edits are never written over.

use anyhow::{Context, Result};
use serde_json::Value;
use shared_data::shelf::{Entry, Ledger, Session};
use std::path::PathBuf;

/// A day with less than this (36 seconds) is a game opened by accident, and would round to nothing.
const SHORTEST_HOURS: f64 = 0.01;

/// The report's games: `(title, [(day, hours)])` of each played one, and the title of each bought one.
struct Report {
    played: Vec<(String, Vec<(String, f64)>)>,
    owned: Vec<String>,
}

fn report_in(json: &Value) -> Report {
    let list = |name: &str| json[name].as_array().cloned().unwrap_or_default();
    Report {
        played: list("played").iter().filter_map(|game| {
            let days = game["days"].as_array()?.iter().filter_map(|day| Some((day["date"].as_str()?.to_string(), day["hours"].as_f64()?))).collect();
            Some((game["title"].as_str()?.to_string(), days))
        }).collect(),
        owned: list("owned").iter().filter_map(|game| Some(game["title"].as_str()?.to_string())).collect(),
    }
}

fn source_of(title: &str) -> String {
    format!("psn:{}", title.to_lowercase())
}

fn owned_entry(title: &str) -> Entry {
    Entry { title: title.trim().to_string(), status: "owned".to_string(), source: Some(source_of(title)), format: Some("playstation".to_string()), ..Entry::default() }
}

/// Every game bought or played is owned; each day played is also a line of the log.
fn entries_in(report: &Report) -> (Vec<Entry>, Vec<Entry>) {
    let owned = report.owned.iter().map(|title| owned_entry(title)).chain(report.played.iter().map(|(title, ..)| owned_entry(title))).collect();
    let played = report
        .played
        .iter()
        .flat_map(|(title, days)| {
            days.iter().filter(|(_, hours)| *hours >= SHORTEST_HOURS).map(move |(day, hours)| Entry {
                on_date: Some(day.clone()),
                status: "playing".to_string(),
                amount: Some(*hours),
                source: Some(format!("{}:{day}", source_of(title))),
                ..owned_entry(title)
            })
        })
        .collect();
    (owned, played)
}

pub fn run(session: &Session) -> Result<()> {
    let service = std::env::var_os("NEXTCLOUD_DIR").map(PathBuf::from).or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Dokumenter/nextcloud"))).unwrap_or_default();
    let file = service.join("export/playstation-games.json");
    let json: Value = serde_json::from_slice(&std::fs::read(&file).with_context(|| format!("reading {}: run `node scripts/playstation-import.ts <report.zip> --apply` in the Nextcloud repository", file.display()))?)
        .with_context(|| format!("parsing {}", file.display()))?;
    let (owned, played) = entries_in(&report_in(&json));
    let added = session.shelf.append_new_in(Ledger::Collection, &session.db, &session.collection, &owned)?;
    let started = session.shelf.append_new(&session.db, &session.log, &played)?;
    println!("psn: {} games, {added} added to the collection, {started} to the log", owned.len());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_game_is_owned_and_one_with_hours_is_in_the_log() {
        let report = report_in(
            &serde_json::from_str::<Value>(
                r#"{"played": [{"title": "Apex Legends", "days": [{"date": "2024-10-07", "hours": 3.4}, {"date": "2024-09-21", "hours": 0.7}]},
                               {"title": "Horizon Forbidden West", "days": [{"date": "2023-11-08", "hours": 0.0}]}],
                    "owned": [{"title": "Celeste", "date": "2023-07-17"}]}"#,
            )
            .unwrap_or_else(|error| panic!("{error}")),
        );
        let (owned, played) = entries_in(&report);
        assert_eq!(owned.len(), 3);
        assert_eq!(played.len(), 2);
        assert_eq!((played[0].on_date.as_deref(), played[0].amount, played[0].source.as_deref(), played[0].format.as_deref()), (Some("2024-10-07"), Some(3.4), Some("psn:apex legends:2024-10-07"), Some("playstation")));
    }
}
