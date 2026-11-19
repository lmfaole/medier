//! The cinema visits of the owner's `Kino` calendar (the `.ics` file `calendar-export` lands from Nextcloud), so a visit
//! written once in the calendar shows in the film app: an upcoming one as planned (`film_planned`), a recent one as a
//! viewing in the film log. Only the film, the day, the time and a known cinema are kept; the rest of an event
//! (description, attendees, address) is never read into the database.

use std::path::Path;

use anyhow::{Context, Result};
use chrono::NaiveDate;
use serde_json::json;
use shared_data::batch::insert_statements;
use shared_data::ics::{events, unfolded};
use shared_data::sqlite_client::SqliteClient;
use shared_data::watch_log::Watch;

use crate::log::LOG;

/// How many days back a visit is still added to the log: older ones are the hand-written log's, not the calendar's.
const LOGGED_DAYS: i64 = 14;

/// What the calendar says of one visit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Visit {
    pub uid: String,
    /// `YYYY-MM-DD`, in the time of the place the event is set in.
    pub on: String,
    /// `HH:MM`, or none for an all-day event.
    pub at: Option<String>,
    pub title: String,
    pub cinema: Option<String>,
}

/// Words that only say it was the cinema, so an event that is nothing else names no film.
const GENERIC: [&str; 3] = ["kino", "kinoen", "cinema"];

/// The ways a cinema is written in an event: its name in the file, and the name without «kino» («Ringen» for «Ringen kino»).
fn spellings(cinemas: &[String]) -> Vec<(String, String)> {
    cinemas
        .iter()
        .flat_map(|name| {
            let short = name.split_whitespace().filter(|word| !GENERIC.contains(&word.to_lowercase().as_str())).collect::<Vec<_>>().join(" ");
            let mut spellings = vec![(name.clone(), name.clone())];
            if short.chars().count() >= 3 && short != *name {
                spellings.push((short, name.clone()));
            }
            spellings
        })
        .collect()
}

/// The film and the cinema an event's title and place say, or none when it names no film: «The Ring på Ringen» at a
/// known cinema is the film «The Ring» there.
fn film_of(summary: &str, location: &str, cinemas: &[String]) -> Option<(String, Option<String>)> {
    let lower = |text: &str| text.to_lowercase();
    let spellings = spellings(cinemas);
    let known = spellings
        .iter()
        .filter(|(spelling, _)| lower(summary).contains(&lower(spelling)) || lower(location).contains(&lower(spelling)))
        .max_by_key(|(spelling, _)| spelling.len());
    let mut title = summary.trim().to_string();
    if let Some((spelling, _)) = known {
        if let Some(start) = lower(&title).find(&lower(spelling)) {
            title.replace_range(start..start + spelling.len(), "");
        }
    }
    let title = title
        .trim_matches(|letter: char| letter.is_whitespace() || "()-–@,".contains(letter))
        .trim_end_matches(" på")
        .trim_end_matches(" i")
        .trim_end_matches(" at")
        .trim()
        .to_string();
    let only_generic = title.is_empty() || lower(&title).split_whitespace().all(|part| GENERIC.contains(&part));
    (!only_generic).then(|| (title, known.map(|(_, name)| name.clone())))
}

/// One visit per film and day: a ticket mail and a hand-made event for the same visit have different UIDs, so the UID
/// cannot tell them apart. The one that says more (a cinema, then a time) is kept.
fn without_repeats(found: Vec<Visit>) -> Vec<Visit> {
    let mut kept: Vec<Visit> = Vec::new();
    for visit in found {
        let same = |other: &Visit| other.on == visit.on && other.title.to_lowercase() == visit.title.to_lowercase();
        match kept.iter().position(same) {
            Some(at) if (visit.cinema.is_some(), visit.at.is_some()) > (kept[at].cinema.is_some(), kept[at].at.is_some()) => kept[at] = visit,
            Some(_) => {}
            None => kept.push(visit),
        }
    }
    kept
}

/// Every visit the calendar names a film for; the cinemas are the names of `film-cinemas.csv`.
#[must_use]
pub fn visits(ics: &str, cinemas: &[String]) -> Vec<Visit> {
    let text = unfolded(ics);
    let found = events(&text)
        .filter(|event| !event.cancelled())
        .filter_map(|event| {
            let (on, at) = event.start()?;
            let (title, cinema) = film_of(&event.value("SUMMARY")?, &event.value("LOCATION").unwrap_or_default(), cinemas)?;
            Some(Visit { uid: event.value("UID")?, on, at, title, cinema })
        })
        .collect();
    without_repeats(found)
}

/// The visits the log lacks, made into lines: recent, past, and no film of that name on that day already.
#[must_use]
pub fn lines_to_log(visits: &[Visit], today: &str, have: &[(String, String)]) -> Vec<Watch> {
    let from = NaiveDate::parse_from_str(today, "%Y-%m-%d").map(|day| (day - chrono::Days::new(LOGGED_DAYS.unsigned_abs())).to_string()).unwrap_or_default();
    visits
        .iter()
        .filter(|visit| visit.on.as_str() < today && visit.on >= from)
        .filter(|visit| !have.iter().any(|(day, title)| *day == visit.on && title.to_lowercase() == visit.title.to_lowercase()))
        .map(|visit| Watch { watched_on: Some(visit.on.clone()), title: visit.title.clone(), place: visit.cinema.clone(), note: Some("fra kalenderen".to_string()), ..Watch::default() })
        .collect()
}

/// Makes `film_planned` the calendar's visits from today on and appends the recent ones the log lacks; says what it did.
pub fn import(db: &SqliteClient, ics: &Path, log: &Path, today: &str) -> Result<()> {
    let text = std::fs::read_to_string(ics).with_context(|| format!("reading {}: run calendar-export in the Nextcloud repository", ics.display()))?;
    let cinemas: Vec<String> = db.query("SELECT name FROM film_cinema", &[])?.iter().filter_map(|row| row["name"].as_str().map(str::to_string)).collect();
    let all = visits(&text, &cinemas);
    let planned: Vec<&Visit> = all.iter().filter(|visit| visit.on.as_str() >= today).collect();
    let mut batch = vec![("DELETE FROM film_planned".to_string(), Vec::new())];
    batch.extend(insert_statements("INSERT OR REPLACE INTO", "film_planned", &["uid", "on_date", "at_time", "title", "cinema"], planned.iter().map(|visit| vec![json!(visit.uid), json!(visit.on), json!(visit.at), json!(visit.title), json!(visit.cinema)])));
    db.execute_batch(&batch).context("replacing the planned visits")?;
    let have: Vec<(String, String)> = db.query("SELECT watched_on, title FROM film_watch WHERE watched_on IS NOT NULL", &[])?.iter().filter_map(|row| Some((row["watched_on"].as_str()?.to_string(), row["title"].as_str()?.to_string()))).collect();
    let lines = lines_to_log(&all, today, &have);
    for watch in &lines {
        LOG.append(log, watch)?;
    }
    if !lines.is_empty() {
        LOG.import(db, log)?;
    }
    println!("import-calendar: {} planned, {} added to the log", planned.len(), lines.len());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{film_of, lines_to_log, visits};

    fn cinemas() -> Vec<String> {
        vec!["Ringen kino".to_string(), "Vega Scene".to_string()]
    }

    #[test]
    fn a_film_and_its_known_cinema_are_told_apart_and_a_bare_cinema_names_no_film() {
        assert_eq!(film_of("The Ring på Ringen", "", &cinemas()), Some(("The Ring".to_string(), Some("Ringen kino".to_string()))));
        assert_eq!(film_of("Rose", "Vega Scene", &cinemas()), Some(("Rose".to_string(), Some("Vega Scene".to_string()))));
        assert_eq!(film_of("Spider-Man", "", &cinemas()), Some(("Spider-Man".to_string(), None)));
        assert_eq!(film_of("Kino", "", &cinemas()), None);
        assert_eq!(film_of("Ringen kino", "", &cinemas()), None);
        assert_eq!(film_of("Kino Ringen", "", &cinemas()), None);
    }

    #[test]
    fn an_event_is_read_with_its_folded_lines_and_a_cancelled_one_is_left_out() {
        let ics = "BEGIN:VEVENT\r\nUID:a\r\nSUMMARY:The Ring på\r\n  Ringen\r\nDTSTART;TZID=Europe/Oslo:20261031T210000\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:b\r\nSUMMARY:Alien\r\nSTATUS:CANCELLED\r\nDTSTART:20261101\r\nEND:VEVENT\r\n";
        let found = visits(ics, &cinemas());
        assert_eq!(found.len(), 1);
        assert_eq!((found[0].on.as_str(), found[0].at.as_deref(), found[0].title.as_str()), ("2026-10-31", Some("21:00"), "The Ring"));
    }

    #[test]
    fn two_events_for_one_film_and_day_are_one_visit_and_the_fuller_one_is_kept() {
        let ics = "BEGIN:VEVENT\nUID:hand\nSUMMARY:The Ring\nDTSTART:20261031\nEND:VEVENT\nBEGIN:VEVENT\nUID:ticket\nSUMMARY:The Ring\nLOCATION:Ringen kino\nDTSTART:20261031T210000\nEND:VEVENT\nBEGIN:VEVENT\nUID:other\nSUMMARY:The Ring\nDTSTART:20261101T210000\nEND:VEVENT\n";
        let found = visits(ics, &cinemas());
        assert_eq!(found.iter().map(|visit| visit.uid.as_str()).collect::<Vec<_>>(), vec!["ticket", "other"]);
    }

    #[test]
    fn only_recent_past_visits_the_log_lacks_are_logged() {
        let ics = "BEGIN:VEVENT\nUID:a\nSUMMARY:Alien\nDTSTART:20261027T200000\nEND:VEVENT\nBEGIN:VEVENT\nUID:b\nSUMMARY:Heat\nDTSTART:20260601T200000\nEND:VEVENT\nBEGIN:VEVENT\nUID:c\nSUMMARY:Rose\nDTSTART:20261026T200000\nEND:VEVENT\nBEGIN:VEVENT\nUID:d\nSUMMARY:Dune\nDTSTART:20261101T200000\nEND:VEVENT\n";
        let all = visits(ics, &cinemas());
        let have = vec![("2026-10-26".to_string(), "rose".to_string())];
        let lines = lines_to_log(&all, "2026-10-28", &have);
        assert_eq!(lines.iter().map(|watch| watch.title.as_str()).collect::<Vec<_>>(), vec!["Alien"]);
    }
}
