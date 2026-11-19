//! Keeps the owner's film in the local database: what was watched, from the log written by hand
//! (`.data/film-log.csv`, `FILM_LOG` names another file), and what the register TMDB says about each film.
//! Run by hand from `apps/film` (`FILM_DB` names another database file); the register's key is `TMDB_API_KEY`.

mod calendar;
mod cinemas;
mod franchises;
mod log;
mod schema;
mod tmdb;
mod trakt;

use std::path::PathBuf;

use anyhow::{Context, Result};
use shared_data::app_db::{open_migrated, path_from_env};
use shared_data::job::{run_from_argv, Job};
use shared_data::sqlite_client::SqliteClient;
use shared_data::watch_log::field;

fn cinemas_path() -> PathBuf {
    path_from_env("FILM_CINEMAS", "../../.data/film-cinemas.csv")
}

/// Says which cinemas the viewings name that `film-cinemas.csv` does not describe yet.
fn report_unknown_cinemas(db: &SqliteClient) {
    let unknown = cinemas::unknown(db);
    if !unknown.is_empty() {
        println!("cinemas the log names that film-cinemas.csv does not have: {}", unknown.join(", "));
    }
}

/// The `Kino` calendar as `calendar-export` mirrors it from Nextcloud (`FILM_CALENDAR` names another file).
fn calendar_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    path_from_env("FILM_CALENDAR", &format!("{home}/Dokumenter/nextcloud/mirror/calendar/Kino.ics"))
}

fn collection_path() -> PathBuf {
    path_from_env("FILM_COLLECTION", "../../.data/film-collection.csv")
}

fn log_path() -> PathBuf {
    path_from_env("FILM_LOG", "../../.data/film-log.csv")
}

fn main() -> Result<()> {
    let jobs = [
        Job::new("import-log", "make the viewings exactly the log's lines", |db: &SqliteClient, _| {
            log::LOG.import_log(db, &log_path())?;
            report_unknown_cinemas(db);
            Ok(())
        }),
        Job::new("import-collection", "make the collection exactly the lines of film-collection.csv", |db: &SqliteClient, _| {
            println!("import-collection: {} films", log::COLLECTION.import(db, &collection_path())?);
            Ok(())
        }),
        Job::new("import-cinemas", "make the cinemas exactly the lines of film-cinemas.csv", |db: &SqliteClient, _| {
            let count = cinemas::import(db, &cinemas_path())?;
            println!("import-cinemas: {count} cinemas");
            report_unknown_cinemas(db);
            Ok(())
        }),
        Job::new("import-calendar", "make the planned visits the Kino calendar's from today on, and add its recent past visits to the log", |db: &SqliteClient, _| {
            let today = chrono::Local::now().format("%Y-%m-%d").to_string();
            calendar::import(db, &calendar_path(), &log_path(), &today)?;
            report_unknown_cinemas(db);
            Ok(())
        }),
        Job::new("add", "add a line to the film log («-» for no rating, year or day) and import it", |db, args| {
            // Built as a line and read back, so what `add` accepts is what `import-log` accepts.
            let line = vec![field(args, 2), args.positional(0).to_string(), field(args, 1), field(args, 3), String::new(), String::new(), String::new(), String::new(), String::new()];
            let watch = log::LOG.parse_line(&line).context("the line to add")?;
            let count = log::LOG.add(db, &log_path(), &watch)?;
            println!("added {} ({}) on {}; {count} viewings in all", watch.title, watch.year.map_or_else(|| "no year".to_string(), |year| year.to_string()), watch.watched_on.as_deref().unwrap_or("an unknown day"));
            Ok(())
        })
        .takes(&["title", "year", "date", "rating"]),
        Job::new("amend", "set the year and the cinema on the log's one line for a title and a day («-» leaves a field as it is) and import it", |db, args| {
            let set = |index| Some(args.positional(index)).filter(|text| *text != "-");
            let count = log::LOG.amend(db, &log_path(), args.positional(0), args.positional(1), set(2), set(3))?;
            println!("amended {} on {}; {count} viewings in all", args.positional(0), args.positional(1));
            Ok(())
        })
        .takes(&["title", "date", "year", "cinema"]),
        Job::new("seat", "set where in the hall the log's one line for a title and a day was sat («-» for a line with no day), as the ticket says: «Sal 1, rad 10, sete 7»", |db, args| {
            let count = log::LOG.set_seat(db, &log_path(), args.positional(0), args.positional(1), args.positional(2))?;
            println!("seat of {} on {}: {}; {count} viewings in all", args.positional(0), args.positional(1), args.positional(2));
            Ok(())
        })
        .takes(&["title", "date", "seat"]),
        Job::new("remove", "take the log's one line for a title and a day («-» for a line with no day) out of the file and import it", |db, args| {
            let count = log::LOG.remove(db, &log_path(), args.positional(0), args.positional(1))?;
            println!("removed {} on {}; {count} viewings in all", args.positional(0), args.positional(1));
            Ok(())
        })
        .takes(&["title", "date"]),
        Job::new("trakt", "add the films of the Trakt history that the log lacks, import, then write the log's days to Trakt when signed in (--dry-run: say what would be written)", |db, args| trakt::run(db, &log_path(), args.flag("--dry-run"))).flags(&["--dry-run"]),
        Job::new("trakt-login", "sign in to Trakt once, so that the log can be written to it (TRAKT_CLIENT_ID)", |_, _| shared_data::trakt::login()),
        Job::new("franchises", "fetch every franchise (TMDB collection) a film belongs to, with each of its parts and the day it came out (--everything: all of them again)", |db: &SqliteClient, args| franchises::run(db, args.flag("--everything"))).flags(&["--everything"]),
        Job::new("titles", "fetch every stored work's details again, so a change in how titles are chosen reaches what is already stored (no people, no search)", |db: &SqliteClient, _| tmdb::run(db, shared_data::tmdb::Refresh::Titles)),
        Job::new("related", "fetch the recommendations of the works stored without any, without fetching their people again", |db: &SqliteClient, _| shared_data::tmdb::run_related(db, &tmdb::PULL)),
        Job::new("tmdb", "look up each film the log names in TMDB and fetch its details (--refresh: those TMDB lists as changed; --everything: all of them again)", |db, args| tmdb::run(db, shared_data::tmdb::Refresh::from_flags(args.flag("--refresh"), args.flag("--everything"))))
            .flags(&["--refresh", "--everything"]),
    ];
    let open = || open_migrated(&path_from_env("FILM_DB", "../../.data/film.db"), schema::SCHEMA, "film").context("opening the film database");
    run_from_argv("film-sync", "", &jobs, open)
}
