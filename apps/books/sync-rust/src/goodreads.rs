//! Goodreads, which has had no open API since 2020 but lets the owner export the library as one CSV
//! (My Books, Import and export, Export Library). `npm run land -- goodreads <file>` keeps the export as it came, and
//! `books-sync goodreads <file or landed folder>` adds the books the log lacks (by `source`, `goodreads:<Book Id>`, so a
//! line the owner has edited is never written again). The facts come from Open Library, not from the export, and the
//! owner's private notes and review in it are not read at all.
//!
//! The other export Goodreads gives, the personal data request (one zip of zips of JSON), has no Book Id, author or
//! year: its shelvings, ratings and reading dates are matched by title, and a book whose title the log already has is
//! left alone.

use std::collections::{BTreeMap, BTreeSet};
use std::io::Read;
use std::path::Path;

use anyhow::{bail, Context, Result};
use csv::StringRecord;
use shared_data::shelf::{Entry, Ledger, Session};
use shared_data::watch_log::blank;

/// The export file in a landed folder, or the file itself.
fn export_in(path: &Path) -> Result<std::path::PathBuf> {
    if path.is_file() {
        return Ok(path.to_path_buf());
    }
    let mut files: Vec<_> = std::fs::read_dir(path).with_context(|| format!("reading {}", path.display()))?.filter_map(|entry| entry.ok().map(|entry| entry.path())).filter(|file| file.extension().is_some_and(|extension| extension == "csv")).collect();
    files.sort();
    files.into_iter().next().with_context(|| format!("{} holds no .csv file", path.display()))
}

/// The log's status for an exclusive shelf; a shelf the owner made themselves is read by its name, and a shelf that is none of these has none.
fn status_of(shelf: &str) -> Option<&'static str> {
    match shelf.trim().to_lowercase().as_str() {
        "read" => Some("done"),
        "currently-reading" => Some("reading"),
        "to-read" => Some("want"),
        other if other.contains("dnf") || other.contains("did-not-finish") || other.contains("abandoned") => Some("dropped"),
        _ => None,
    }
}

/// «Dune (Dune, #1)» → «Dune»: Goodreads puts the series in the title, and the register does not know it there.
fn title_of(title: &str) -> String {
    let title = title.trim();
    match title.rfind(" (") {
        Some(start) if title.ends_with(')') && title[start..].contains('#') => title[..start].trim_end().to_string(),
        _ => title.to_string(),
    }
}

/// «2020/05/12» → «2020-05-12»; anything else is no day.
fn day_of(text: &str) -> Option<String> {
    let day = text.trim().replace('/', "-");
    (day.len() == 10 && day.matches('-').count() == 2).then_some(day)
}

fn number(text: &str) -> Option<f64> {
    blank(text)?.parse::<f64>().ok().filter(|value| *value > 0.0)
}

fn year(text: &str) -> Option<i64> {
    blank(text)?.parse::<i64>().ok().filter(|value| *value > 0)
}

/// The books of an export, each by the columns the header names.
fn entries_in(text: &str) -> Result<Vec<Entry>> {
    let mut reader = csv::ReaderBuilder::new().flexible(true).from_reader(text.as_bytes());
    let header = reader.headers().context("reading the export's header")?.clone();
    let column = |name: &str| header.iter().position(|candidate| candidate == name).with_context(|| format!("the export has no «{name}» column: is it the Goodreads library export?"));
    let [id, title, rating, pages, published, original, read, added, shelf] = ["Book Id", "Title", "My Rating", "Number of Pages", "Year Published", "Original Publication Year", "Date Read", "Date Added", "Exclusive Shelf"].map(column).into_iter().collect::<Result<Vec<_>>>()?[..] else {
        bail!("the export's columns could not be read");
    };
    let mut entries = Vec::new();
    for record in reader.records() {
        let record: StringRecord = record.context("reading a line of the export")?;
        let field = |index: usize| record.get(index).unwrap_or_default();
        let Some(status) = status_of(field(shelf)) else { continue };
        let book = field(id).trim().to_string();
        if book.is_empty() || blank(field(title)).is_none() {
            continue;
        }
        entries.push(Entry {
            on_date: match status {
                "done" | "dropped" => day_of(field(read)).or_else(|| day_of(field(added))),
                "reading" => day_of(field(added)),
                _ => None,
            },
            title: title_of(field(title)),
            year: year(field(original)).or_else(|| year(field(published))),
            status: status.to_string(),
            rating: number(field(rating)),
            amount: if status == "done" { number(field(pages)) } else { None },
            source: Some(format!("goodreads:{book}")),
            ..Entry::default()
        });
    }
    Ok(entries)
}

/// The zip of the personal data request in a landed folder, or the file itself.
fn request_in(path: &Path) -> Option<std::path::PathBuf> {
    if path.is_file() {
        return path.extension().is_some_and(|extension| extension == "zip").then(|| path.to_path_buf());
    }
    let mut files: Vec<_> = std::fs::read_dir(path).ok()?.filter_map(|entry| entry.ok().map(|entry| entry.path())).filter(|file| file.extension().is_some_and(|extension| extension == "zip")).collect();
    files.sort();
    files.into_iter().next()
}

/// The records of one file of the request («shelvings», …): a zip inside the zip, holding one JSON array whose first element only explains the file.
fn records_in(outer: &mut zip::ZipArchive<std::fs::File>, name: &str) -> Result<Vec<serde_json::Value>> {
    let mut inner_bytes = Vec::new();
    outer.by_name(&format!("{name}.zip")).with_context(|| format!("the request has no {name}.zip: is it the Goodreads personal data request?"))?.read_to_end(&mut inner_bytes).with_context(|| format!("reading {name}.zip"))?;
    let mut inner = zip::ZipArchive::new(std::io::Cursor::new(inner_bytes)).with_context(|| format!("opening {name}.zip"))?;
    let mut json = String::new();
    inner.by_name(&format!("{name}.json")).with_context(|| format!("{name}.zip has no {name}.json"))?.read_to_string(&mut json).with_context(|| format!("reading {name}.json"))?;
    let serde_json::Value::Array(mut records) = serde_json::from_str(&json).with_context(|| format!("parsing {name}.json"))? else { bail!("{name}.json is not a list") };
    if !records.is_empty() {
        records.remove(0);
    }
    Ok(records)
}

fn text<'a>(record: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    blank(record.get(key)?.as_str()?).filter(|value| *value != "(not provided)")
}

/// «2026-06-27 00:00:00 UTC» → «2026-06-27».
fn day_in(record: &serde_json::Value, key: &str) -> Option<String> {
    day_of(text(record, key)?.get(..10)?)
}

/// How the log is matched against a title it does not know the number of: lower case, without the subtitle.
fn key_of(title: &str) -> String {
    title_of(title).split(':').next().unwrap_or_default().trim().to_lowercase()
}

/// Whether `key` names the same book as one the log has: equal, or the log's whole words inside it («Meatspace Press Eaten by the Internet.»).
fn is_known(known: &BTreeSet<String>, key: &str) -> bool {
    let words = |text: &str| text.split(|character: char| !character.is_alphanumeric()).filter(|word| !word.is_empty()).collect::<Vec<_>>().join(" ");
    let padded = format!(" {} ", words(key));
    known.iter().any(|have| have == key || (!have.is_empty() && padded.contains(&format!(" {} ", words(have)))))
}

/// The books of a personal data request. The review, the shelving's notes and every other file are not read.
fn request_entries(outer: &mut zip::ZipArchive<std::fs::File>) -> Result<Vec<Entry>> {
    let ratings: BTreeMap<String, f64> = records_in(outer, "reviews")?.iter().flat_map(|file| file.get("reviews").and_then(|list| list.as_array()).cloned().unwrap_or_default()).filter_map(|review| Some((key_of(text(&review, "book")?), number(&review.get("rating")?.to_string())?))).collect();
    let mut sessions: BTreeMap<String, Vec<serde_json::Value>> = BTreeMap::new();
    for session in records_in(outer, "reading_sessions")? {
        if let Some(book) = text(&session, "book") {
            sessions.entry(key_of(book)).or_default().push(session);
        }
    }
    let mut entries = Vec::new();
    for shelving in records_in(outer, "shelvings")? {
        let (Some(book), Some(status)) = (text(&shelving, "book"), text(&shelving, "read_status").and_then(status_of)) else { continue };
        let key = key_of(book);
        let own = sessions.get(&key).map(Vec::as_slice).unwrap_or_default();
        entries.push(Entry {
            on_date: match status {
                "done" | "dropped" => own.iter().filter_map(|session| day_in(session, "ended_at")).max(),
                "reading" => own.iter().filter_map(|session| day_in(session, "started_at")).max(),
                _ => None,
            },
            title: title_of(book),
            status: status.to_string(),
            rating: ratings.get(&key).copied(),
            source: Some(format!("goodreads:title:{key}")),
            ..Entry::default()
        });
    }
    Ok(entries)
}

/// The books the owner has read or is reading go to the log; the ones on the to-read shelf to the collection.
fn append(session: &Session, entries: &[Entry]) -> Result<usize> {
    let (wanted, log): (Vec<Entry>, Vec<Entry>) = entries.iter().cloned().partition(|entry| entry.status == "want");
    Ok(session.shelf.append_new(&session.db, &session.log, &log)? + session.shelf.append_new_in(Ledger::Collection, &session.db, &session.collection, &wanted)?)
}

fn run_request(session: &Session, file: &Path) -> Result<()> {
    let mut outer = zip::ZipArchive::new(std::fs::File::open(file).with_context(|| format!("opening {}", file.display()))?).with_context(|| format!("{} is no zip", file.display()))?;
    let found = request_entries(&mut outer)?;
    let mut known: BTreeSet<String> = BTreeSet::new();
    for (ledger, path) in [(Ledger::Log, &session.log), (Ledger::Collection, &session.collection)] {
        if path.exists() {
            known.extend(session.shelf.read_in(ledger, &session.shelf.read_file(path)?)?.iter().map(|entry| key_of(&entry.title)));
        }
    }
    let new: Vec<Entry> = found.iter().filter(|entry| !is_known(&known, &key_of(&entry.title))).cloned().collect();
    let added = append(session, &new)?;
    println!("goodreads: {} books in {}, {} already in the log by title, {added} added", found.len(), file.display(), found.len() - new.len());
    Ok(())
}

pub fn run(session: &Session, path: &Path) -> Result<()> {
    if export_in(path).is_err() {
        if let Some(file) = request_in(path) {
            return run_request(session, &file);
        }
    }
    let file = export_in(path)?;
    let text = std::fs::read_to_string(&file).with_context(|| format!("reading {}", file.display()))?;
    let entries = entries_in(&text)?;
    let added = append(session, &entries)?;
    println!("goodreads: {} books in {}, {added} added to the log or the collection", entries.len(), file.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXPORT: &str = "Book Id,Title,Author,My Rating,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Exclusive Shelf,Private Notes\n\
        1,\"Dune (Dune, #1)\",Frank Herbert,5,612,2005,1965,2024/03/05,2024/01/01,read,secret\n\
        2,Emma,Jane Austen,0,400,2003,,,2024/04/01,currently-reading,\n\
        3,Ulysses,James Joyce,0,700,1990,1922,,2024/04/02,to-read,\n\
        4,Abandoned,X,3,0,,,2023/01/01,2023/01/02,dnf,\n\
        5,Odd,Y,4,10,2000,,2020/01/01,2020/01/01,my-own-shelf,\n";

    #[test]
    fn a_shelf_becomes_a_status_and_the_series_is_taken_out_of_the_title() {
        let entries = entries_in(EXPORT).unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!(entries.len(), 4);
        assert_eq!((entries[0].title.as_str(), entries[0].status.as_str(), entries[0].on_date.as_deref(), entries[0].year, entries[0].rating, entries[0].amount, entries[0].source.as_deref()), ("Dune", "done", Some("2024-03-05"), Some(1965), Some(5.0), Some(612.0), Some("goodreads:1")));
        assert_eq!((entries[1].status.as_str(), entries[1].on_date.as_deref(), entries[1].year, entries[1].amount), ("reading", Some("2024-04-01"), Some(2003), None));
        assert_eq!((entries[2].status.as_str(), entries[2].title.as_str()), ("want", "Ulysses"));
        assert_eq!((entries[3].status.as_str(), entries[3].on_date.as_deref(), entries[3].rating, entries[3].source.as_deref()), ("dropped", Some("2023-01-01"), Some(3.0), Some("goodreads:4")));
        // The owner's private notes are in the export and nowhere else.
        assert!(entries.iter().all(|entry| entry.note.is_none()));
    }

    fn request_zip(name: &str, json: &str) -> Vec<u8> {
        use std::io::Write;
        use zip::write::SimpleFileOptions;
        let mut inner = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        inner.start_file(format!("{name}.json"), SimpleFileOptions::default()).unwrap_or_else(|error| panic!("{error}"));
        inner.write_all(json.as_bytes()).unwrap_or_else(|error| panic!("{error}"));
        inner.finish().unwrap_or_else(|error| panic!("{error}")).into_inner()
    }

    #[test]
    fn a_data_request_gives_status_rating_and_day_by_title_and_reads_no_notes() {
        use std::io::Write;
        use zip::write::SimpleFileOptions;
        let mut outer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for (name, json) in [
            ("shelvings", r#"[{"explanation":["x"]},{"read_status":"read","book":"Dune: Deluxe","notes":"secret"},{"read_status":"currently-reading","book":"Emma"},{"read_status":"to-read","book":"Ulysses"},{"read_status":"did-not-finish","book":"Odd (S, #2)"}]"#),
            ("reviews", r#"[{"explanation":["x"]},{"reviews":[{"book":"Dune","rating":4.0,"review":"secret"}]}]"#),
            ("reading_sessions", r#"[{"explanation":["x"]},{"book":"Dune","started_at":"(not provided)","ended_at":"2026-05-01 00:00:00 UTC"},{"book":"Emma","started_at":"2026-06-27 00:00:00 UTC","ended_at":"(not provided)"}]"#),
        ] {
            outer.start_file(format!("{name}.zip"), SimpleFileOptions::default()).unwrap_or_else(|error| panic!("{error}"));
            outer.write_all(&request_zip(name, json)).unwrap_or_else(|error| panic!("{error}"));
        }
        let bytes = outer.finish().unwrap_or_else(|error| panic!("{error}")).into_inner();
        let file = std::env::temp_dir().join(format!("goodreads-request-{}.zip", std::process::id()));
        std::fs::write(&file, bytes).unwrap_or_else(|error| panic!("{error}"));
        let mut archive = zip::ZipArchive::new(std::fs::File::open(&file).unwrap_or_else(|error| panic!("{error}"))).unwrap_or_else(|error| panic!("{error}"));
        let entries = request_entries(&mut archive).unwrap_or_else(|error| panic!("{error:#}"));
        std::fs::remove_file(&file).ok();
        assert_eq!(entries.len(), 4);
        assert_eq!((entries[0].status.as_str(), entries[0].rating, entries[0].on_date.as_deref(), entries[0].source.as_deref()), ("done", Some(4.0), Some("2026-05-01"), Some("goodreads:title:dune")));
        assert_eq!((entries[1].status.as_str(), entries[1].on_date.as_deref()), ("reading", Some("2026-06-27")));
        assert_eq!((entries[2].status.as_str(), entries[2].on_date.as_deref()), ("want", None));
        assert_eq!((entries[3].status.as_str(), entries[3].title.as_str()), ("dropped", "Odd"));
        assert!(entries.iter().all(|entry| entry.note.is_none()));
    }

    #[test]
    fn a_title_the_log_has_is_known_whole_or_as_whole_words() {
        let known = BTreeSet::from(["eaten by the internet".to_string(), "varslerne".to_string()]);
        assert!(is_known(&known, "meatspace press eaten by the internet."));
        assert!(is_known(&known, "varslerne. en fortelling"));
        assert!(!is_known(&known, "eaten"));
    }

    #[test]
    fn an_export_that_is_not_goodreads_is_refused_naming_the_missing_column() {
        let error = format!("{:#}", entries_in("a,b\n1,2\n").err().unwrap_or_else(|| panic!("a wrong file was accepted")));
        assert!(error.contains("Book Id"), "{error}");
    }

    #[test]
    fn a_title_keeps_a_parenthesis_that_is_not_a_series() {
        assert_eq!(title_of("Catch-22 (Special Edition)"), "Catch-22 (Special Edition)");
        assert_eq!(title_of("The Hobbit (The Lord of the Rings, #0)"), "The Hobbit");
    }
}
