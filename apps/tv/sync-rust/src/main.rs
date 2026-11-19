//! Keeps the owner's tv in the local database: what was watched, from the log written by hand (`.data/tv-log.csv`,
//! `TV_LOG` names another file), and what the series register TMDB says about each series. Run by hand from `apps/tv`
//! (`TV_DB` names another database file); the register's key is `TMDB_API_KEY`.

mod airdates;
mod apple;
mod episodes;
mod expand;
mod log;
mod schema;
mod trakt;
mod trakt_push;
mod tvmaze;
mod tmdb;

use std::path::PathBuf;

use anyhow::{bail, Context, Result};
use shared_data::app_db::{open_migrated, path_from_env};
use shared_data::job::{run_from_argv, Args, Job};
use shared_data::sqlite_client::SqliteClient;
use shared_data::watch_log::{self, Watch};

fn log_path() -> PathBuf {
    path_from_env("TV_LOG", "../../.data/tv-log.csv")
}

/// One line of the log as `add` and `add-season` build it: both take `<series> <year> <season> … <date> <rating>`, and
/// only the episode differs (the one the job names, or each of a season in turn).
fn line(args: &Args, episode: &str) -> Vec<String> {
    vec![
        watch_log::field(args, 4),
        args.positional(0).to_string(),
        watch_log::field(args, 1),
        watch_log::field(args, 2),
        episode.to_string(),
        watch_log::field(args, 5),
        String::new(),
        String::new(),
        String::new(),
    ]
}

/// What one episode is called in the closing line: `s1e2`, `s1e?`, or nothing for a viewing of the series as such.
fn place(watch: &Watch) -> String {
    let count = |number: Option<i64>| number.map_or_else(|| "?".to_string(), |number| number.to_string());
    match (watch.season, watch.episode) {
        (None, None) => String::new(),
        (season, episode) => format!(" s{}e{}", count(season), count(episode)),
    }
}

/// Says where an episode of a series was watched, as the log ends up calling it.
fn added(watch: &Watch, count: usize) -> String {
    format!("added {}{} on {}; {count} viewings in all", watch.title, place(watch), watch.watched_on.as_deref().unwrap_or("an unknown day"))
}

fn collection_path() -> PathBuf {
    path_from_env("TV_COLLECTION", "../../.data/tv-collection.csv")
}

fn main() -> Result<()> {
    let jobs = [
        apple::job(),
        Job::new("import-log", "make the viewings exactly the log's lines", |db: &SqliteClient, _| log::LOG.import_log(db, &log_path())),
        Job::new("import-collection", "make the collection exactly the lines of tv-collection.csv", |db: &SqliteClient, _| {
            println!("import-collection: {} series", log::COLLECTION.import(db, &collection_path())?);
            Ok(())
        }),
        Job::new("add", "add one episode to the tv log («-» for no rating, year, season, episode or day) and import it", |db, args| {
            let watch = log::LOG.parse_line(&line(args, &watch_log::field(args, 3))).context("the line to add")?;
            let count = log::LOG.add(db, &log_path(), &watch)?;
            println!("{}", added(&watch, count));
            Ok(())
        })
        .takes(&["series", "year", "season", "episode", "date", "rating"]),
        Job::new("add-series", "add a series seen as a whole to the tv log («-» for no year or day; run tmdb and expand afterwards to get its episodes) and import it", |db, args| {
            let line = vec![watch_log::field(args, 2), args.positional(0).to_string(), watch_log::field(args, 1), String::new(), String::new(), String::new(), String::new(), String::new(), String::new()];
            let watch = log::LOG.parse_line(&line).context("the line to add")?;
            let known = log::LOG.read(&log::LOG.read_file(&log_path())?)?.iter().any(|have| have.title.eq_ignore_ascii_case(&watch.title) && (have.year == watch.year || watch.year.is_none()));
            if known {
                println!("{} is in the log already", watch.title);
                return Ok(());
            }
            let count = log::LOG.add(db, &log_path(), &watch)?;
            println!("added {}; {count} viewings in all", watch.title);
            Ok(())
        })
        .takes(&["series", "year", "date"]),
        Job::new("add-season", "add a whole season to the tv log, each episode on the same day («-» for no rating, year or day) and import it", |db, args| {
            let episodes: usize = args.positional(3).parse().with_context(|| format!("«{}» is not a number of episodes", args.positional(3)))?;
            if episodes == 0 {
                bail!("a season has at least one episode");
            }
            let path = log_path();
            for episode in 1..=episodes {
                let watch = log::LOG.parse_line(&line(args, &episode.to_string())).context("the line to add")?;
                log::LOG.append(&path, &watch)?;
            }
            let count = log::LOG.import(db, &path)?;
            println!("added {episodes} episodes; {count} viewings in all");
            Ok(())
        })
        .takes(&["series", "year", "season", "episodes", "date", "rating"]),
        Job::new("air-dates", "move a series' viewings in the log to the day each episode came out (its TMDB number; the old log is kept beside it)", |db, args| {
            let series: i64 = args.positional(0).parse().with_context(|| format!("«{}» is not a TMDB number", args.positional(0)))?;
            airdates::run(db, &log_path(), series)
        })
        .takes(&["tmdb_id"]),
        Job::new("expand", "make each whole-series line of the log a line per episode that has come out, on its release day (run tmdb first)", |db, _| expand::run(db, &log_path())),
        Job::new("trakt", "add the episodes of the public Trakt history that the log lacks, import, then write the log's days to Trakt when signed in (--dry-run: say what would be written)", |db, args| trakt::run(db, &log_path(), args.flag("--dry-run"))).flags(&["--dry-run"]),
        Job::new("trakt-login", "sign in to Trakt once, so that the log can be written to it (TRAKT_CLIENT_ID)", |_, _| shared_data::trakt::login()),
        Job::new("tvmaze", "fetch when the next episode of each series in the log comes out, from TVmaze", |db, _| tvmaze::run(db)),
        Job::new("titles", "fetch every stored work's details again, so a change in how titles are chosen reaches what is already stored (no people, no search)", |db: &SqliteClient, _| tmdb::run(db, shared_data::tmdb::Refresh::Titles)),
        Job::new("related", "fetch the recommendations of the works stored without any, without fetching their people again", |db: &SqliteClient, _| shared_data::tmdb::run_related(db, &tmdb::PULL)),
        Job::new("tmdb", "look up each series the log names in TMDB and fetch its details (--refresh: those TMDB lists as changed; --everything: all of them again)", |db, args| {
            let refresh = shared_data::tmdb::Refresh::from_flags(args.flag("--refresh"), args.flag("--everything"));
            tmdb::run(db, refresh)?;
            episodes::run(db, refresh)
        })
        .flags(&["--refresh", "--everything"]),
    ];
    let open = || open_migrated(&path_from_env("TV_DB", "../../.data/tv.db"), schema::SCHEMA, "tv").context("opening the tv database");
    run_from_argv("tv-sync", "", &jobs, open)
}
