//! The concerts of the owner's `Konserter` calendar (the `.ics` file `calendar-export` mirrors from Nextcloud), so a concert
//! written once in the calendar shows in the music app, upcoming or past, with the Immich album of its photos. Only the title, the
//! day, the time and the venue are kept; the rest of an event (description, attendees) is never read into the database. The album
//! ids are the file `event-albums` writes in the Nextcloud repository, `{uid: albumId}`.

use std::collections::HashMap;
use std::path::Path;

use anyhow::{Context, Result};
use serde_json::json;
use shared_data::batch::insert_statements;
use shared_data::ics::{events, unfolded};
use shared_data::sqlite_client::SqliteClient;

/// What the calendar says of one concert.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Concert {
    pub uid: String,
    /// `YYYY-MM-DD`.
    pub on: String,
    /// `HH:MM`, or none for an all-day event.
    pub at: Option<String>,
    pub title: String,
    pub venue: Option<String>,
}

/// Every concert of the calendar, a cancelled event and one with no title or day left out, the oldest first.
#[must_use]
pub fn concerts(ics: &str) -> Vec<Concert> {
    let text = unfolded(ics);
    let mut found: Vec<Concert> = events(&text)
        .filter(|event| !event.cancelled())
        .filter_map(|event| {
            let (on, at) = event.start()?;
            let title = event.value("SUMMARY").filter(|title| !title.is_empty())?;
            Some(Concert { uid: event.value("UID")?, on, at, title, venue: event.value("LOCATION").filter(|venue| !venue.is_empty()) })
        })
        .collect();
    found.sort_by(|a, b| (&a.on, &a.at).cmp(&(&b.on, &b.at)));
    found
}

/// `{uid: albumId}` as the file holds it; no file is no albums yet.
fn album_ids(path: &Path) -> Result<HashMap<String, String>> {
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let text = std::fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
    serde_json::from_str(&text).with_context(|| format!("{} is not a JSON object of uid and album id", path.display()))
}

/// Makes `music_concert_event` the calendar's concerts, each with its album where there is one; says what it did.
pub fn import(db: &SqliteClient, ics: &Path, albums: &Path) -> Result<()> {
    let text = std::fs::read_to_string(ics).with_context(|| format!("reading {}: run calendar-export in the Nextcloud repository", ics.display()))?;
    let all = concerts(&text);
    let albums = album_ids(albums)?;
    let mut batch = vec![("DELETE FROM music_concert_event".to_string(), Vec::new())];
    batch.extend(insert_statements(
        "INSERT OR REPLACE INTO",
        "music_concert_event",
        &["uid", "on_date", "at_time", "title", "venue", "album_id"],
        all.iter().map(|concert| vec![json!(concert.uid), json!(concert.on), json!(concert.at), json!(concert.title), json!(concert.venue), json!(albums.get(&concert.uid))]),
    ));
    db.execute_batch(&batch).context("replacing the concerts of the calendar")?;
    println!("import-concerts-calendar: {} concerts, {} with an album", all.len(), all.iter().filter(|concert| albums.contains_key(&concert.uid)).count());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::concerts;

    #[test]
    fn a_concert_is_read_with_its_folded_lines_and_a_cancelled_one_is_left_out() {
        let ics = "BEGIN:VEVENT\r\nUID:b\r\nSUMMARY:Carina Dahl\r\nLOCATION:Rockefeller\\, Oslo\r\nDTSTART;TZID=Europe/Oslo:20260220T200000\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:a\r\nSUMMARY:Aurora på\r\n  Sentrum\r\nDTSTART;TZID=Europe/Oslo:20260110T190000\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:c\r\nSUMMARY:Avlyst\r\nSTATUS:CANCELLED\r\nDTSTART:20260301\r\nEND:VEVENT\r\n";
        let found = concerts(ics);
        assert_eq!(found.iter().map(|concert| concert.uid.as_str()).collect::<Vec<_>>(), vec!["a", "b"]);
        assert_eq!((found[0].title.as_str(), found[0].at.as_deref(), found[0].venue.as_deref()), ("Aurora på Sentrum", Some("19:00"), None));
        assert_eq!((found[1].on.as_str(), found[1].venue.as_deref()), ("2026-02-20", Some("Rockefeller, Oslo")));
    }

    #[test]
    fn an_all_day_concert_has_no_time() {
        let found = concerts("BEGIN:VEVENT\nUID:a\nSUMMARY:Festival\nDTSTART;VALUE=DATE:20260620\nEND:VEVENT\n");
        assert_eq!((found[0].on.as_str(), found[0].at.as_deref()), ("2026-06-20", None));
    }
}
