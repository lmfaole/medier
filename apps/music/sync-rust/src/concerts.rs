//! The concerts the owner has been to: `.data/music-concerts.csv` (`MUSIC_CONCERTS` names another file), a line each, written
//! by `mail-concerts` from the ticket receipts or by hand. The reading, the checking and the writing are
//! `shared_data::watch_log`, which the collection and the film log share; this file says which columns a concert has.

use anyhow::{Context, Result};
use shared_data::app_db::path_from_env;
use shared_data::job::{Args, Job};
use shared_data::sqlite_client::SqliteClient;
use shared_data::watch_log::{field, Log};

/// The concert log, as the file's header writes it: the day, the event and the venue.
pub const CONCERTS: Log = Log {
    header: &["watched_on", "title", "place"],
    table: "music_concert",
    name: "music concerts",
    made_by: "run `npm run mail:concerts`, or write .data/music-concerts.csv by hand",
    statuses: &[],
};

const ACT_HEADER: [&str; 4] = ["watched_on", "title", "artist", "billing"];

/// The jobs of the concert log, which `main` adds to its own.
#[must_use]
pub fn jobs() -> Vec<Job<SqliteClient>> {
    vec![
        Job::new("import-concerts", "make the concerts exactly the lines of music-concerts.csv", |db, _| import(db)),
        Job::new("import-concerts-calendar", "make the calendar concerts exactly the events of the Konserter calendar, with their Immich albums", |db, _| import_calendar(db)),
        Job::new("concert-photos", "keep the favourite photos of each concert's Immich album as small pictures in .data/concert-photos", |db, _| crate::concert_photos::run(db)),
        Job::new("add-concert-act", "add an artist the owner saw at a concert already in the log: <title> <date> <artist> <billing: headliner, support or ->", add_act).takes(&["title", "date", "artist", "billing"]),
        Job::new("add-concert", "add a concert to the concert log and import it: <title> <venue> <date>", add).takes(&["title", "venue", "date"]),
    ]
}

fn path() -> std::path::PathBuf {
    path_from_env("MUSIC_CONCERTS", "../../.data/music-concerts.csv")
}

/// The `Konserter` calendar as `calendar-export` mirrors it from Nextcloud (`MUSIC_CONCERT_CALENDAR` names another file), and
/// the album ids `event-albums` writes beside it (`MUSIC_CONCERT_ALBUMS`).
fn nextcloud(file: &str) -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    std::path::PathBuf::from(format!("{home}/Dokumenter/nextcloud/{file}"))
}

/// The `import-concerts-calendar` job.
pub fn import_calendar(db: &SqliteClient) -> Result<()> {
    let calendar = std::env::var_os("MUSIC_CONCERT_CALENDAR").map_or_else(|| nextcloud("mirror/calendar/Konserter.ics"), std::path::PathBuf::from);
    let albums = std::env::var_os("MUSIC_CONCERT_ALBUMS").map_or_else(|| nextcloud("raw/immich/event-albums.json"), std::path::PathBuf::from);
    crate::concert_calendar::import(db, &calendar, &albums)
}

fn acts_path() -> std::path::PathBuf {
    path_from_env("MUSIC_CONCERT_ACTS", "../../.data/music-concert-acts.csv")
}

/// One line of the acts file: a day, a concert's title, an artist and a billing (`headliner`, `support` or none).
#[derive(Debug, PartialEq)]
pub struct Act {
    pub watched_on: String,
    pub title: String,
    pub artist: String,
    pub billing: Option<String>,
}

/// The acts in the file's text, the header skipped; a wrong line is refused with its line number.
pub fn read_acts(text: &str) -> Result<Vec<Act>> {
    let mut reader = csv::ReaderBuilder::new().has_headers(false).comment(Some(b'#')).flexible(true).from_reader(text.as_bytes());
    let mut acts = Vec::new();
    for (index, record) in reader.records().enumerate() {
        let record = record.with_context(|| format!("reading record {} of the concert acts", index + 1))?;
        if index == 0 && record.get(0).is_some_and(|first| first.trim() == ACT_HEADER[0]) {
            continue;
        }
        acts.push(parse_act(&record.iter().map(str::to_string).collect::<Vec<_>>()).with_context(|| format!("line {} of the concert acts", index + 1))?);
    }
    Ok(acts)
}

fn parse_act(fields: &[String]) -> Result<Act> {
    let at = |index: usize| fields.get(index).map(String::as_str).unwrap_or_default();
    let watched_on = shared_data::watch_log::parse_watched_on(at(0))?.context("the day is empty")?;
    let title = shared_data::watch_log::blank(at(1)).context("the title is empty")?.to_string();
    let artist = shared_data::watch_log::blank(at(2)).context("the artist is empty")?.to_string();
    let billing = shared_data::watch_log::blank(at(3)).map(str::to_lowercase);
    if let Some(billing) = billing.as_deref() {
        anyhow::ensure!(["headliner", "support"].contains(&billing), "«{billing}» is not headliner or support");
    }
    Ok(Act { watched_on, title, artist, billing })
}

fn replace_acts(db: &SqliteClient, acts: &[Act]) -> Result<()> {
    let rows = acts.iter().map(|act| vec![serde_json::json!(act.watched_on), serde_json::json!(act.title), serde_json::json!(act.artist), serde_json::json!(act.billing)]).collect();
    shared_data::log_file::replace(db, "music_concert_act", &ACT_HEADER, rows, "concert acts")
}

fn albums_path() -> std::path::PathBuf {
    path_from_env("MUSIC_CONCERT_ALBUMS_LOG", "../../.data/music-concert-albums.csv")
}

/// The albums in the file's text (`watched_on,title,album_id`), the header skipped: a day, a concert's title and an Immich album id.
pub fn read_albums(text: &str) -> Result<Vec<[String; 3]>> {
    let mut reader = csv::ReaderBuilder::new().has_headers(false).comment(Some(b'#')).flexible(true).from_reader(text.as_bytes());
    let mut albums = Vec::new();
    for (index, record) in reader.records().enumerate() {
        let record = record.with_context(|| format!("reading record {} of the concert albums", index + 1))?;
        if index == 0 && record.get(0).is_some_and(|first| first.trim() == "watched_on") {
            continue;
        }
        let at = |column: usize| record.get(column).unwrap_or_default().trim().to_string();
        let day = shared_data::watch_log::parse_watched_on(&at(0)).with_context(|| format!("line {} of the concert albums", index + 1))?.with_context(|| format!("line {} of the concert albums: the day is empty", index + 1))?;
        let (title, album) = (at(1), at(2));
        anyhow::ensure!(!title.is_empty() && !album.is_empty(), "line {} of the concert albums needs a title and an album id", index + 1);
        albums.push([day, title, album]);
    }
    Ok(albums)
}

fn venues_path() -> std::path::PathBuf {
    path_from_env("MUSIC_VENUES", "../../.data/music-venues.csv")
}

/// The venues in the file's text (`venue,lat,lon`), the header skipped: a venue's text and where it is.
pub fn read_venues(text: &str) -> Result<Vec<(String, f64, f64)>> {
    let mut reader = csv::ReaderBuilder::new().has_headers(false).comment(Some(b'#')).flexible(true).from_reader(text.as_bytes());
    let mut venues = Vec::new();
    for (index, record) in reader.records().enumerate() {
        let record = record.with_context(|| format!("reading record {} of the venues", index + 1))?;
        if index == 0 && record.get(0).is_some_and(|first| first.trim() == "venue") {
            continue;
        }
        let number = |column: usize, what: &str| record.get(column).unwrap_or_default().trim().parse::<f64>().with_context(|| format!("line {} of the venues: the {what} is not a number", index + 1));
        let name = record.get(0).unwrap_or_default().trim().to_string();
        anyhow::ensure!(!name.is_empty(), "line {} of the venues has no venue", index + 1);
        let (lat, lon) = (number(1, "latitude")?, number(2, "longitude")?);
        anyhow::ensure!((-90.0..=90.0).contains(&lat) && (-180.0..=180.0).contains(&lon), "line {} of the venues is not a place on Earth", index + 1);
        venues.push((name, lat, lon));
    }
    Ok(venues)
}

/// The `import-concerts` job: the tables become exactly the files' lines (the acts, albums and venues files are optional).
pub fn import(db: &SqliteClient) -> Result<()> {
    println!("import-concerts: {} lines", CONCERTS.import(db, &path())?);
    let acts = match std::fs::read_to_string(acts_path()) {
        Ok(text) => read_acts(&text)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(error) => return Err(error).context("reading the concert acts"),
    };
    replace_acts(db, &acts)?;
    println!("import-concerts: {} acts", acts.len());
    let albums = match std::fs::read_to_string(albums_path()) {
        Ok(text) => read_albums(&text)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(error) => return Err(error).context("reading the concert albums"),
    };
    let rows = albums.iter().map(|album| album.iter().map(|field| serde_json::json!(field)).collect()).collect();
    shared_data::log_file::replace(db, "music_concert_album", &["watched_on", "title", "album_id"], rows, "concert albums")?;
    println!("import-concerts: {} albums", albums.len());
    let venues = match std::fs::read_to_string(venues_path()) {
        Ok(text) => read_venues(&text)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(error) => return Err(error).context("reading the venues"),
    };
    let rows = venues.iter().map(|(name, lat, lon)| vec![serde_json::json!(name), serde_json::json!(lat), serde_json::json!(lon)]).collect();
    shared_data::log_file::replace(db, "music_venue", &["venue", "lat", "lon"], rows, "venues")?;
    println!("import-concerts: {} venues", venues.len());
    Ok(())
}

/// Writes one act to the acts file and imports it, for a concert that is in the log; an act already written for the concert is left as it is.
pub fn add_act_line(db: &SqliteClient, day: &str, title: &str, artist: &str, billing: &str) -> Result<()> {
    let line = vec![day.to_string(), title.to_string(), artist.to_string(), billing.to_string()];
    let act = parse_act(&line).context("the act to add")?;
    let known = std::fs::read_to_string(path()).ok().map(|text| CONCERTS.read(&text)).transpose()?.unwrap_or_default();
    anyhow::ensure!(known.iter().any(|concert| concert.watched_on.as_deref() == Some(act.watched_on.as_str()) && concert.title == act.title), "no concert «{}» on {} in the concert log; add it first with add-concert", act.title, act.watched_on);
    let written = std::fs::read_to_string(acts_path()).ok().map(|text| read_acts(&text)).transpose()?.unwrap_or_default();
    if written.iter().any(|other| other.watched_on == act.watched_on && other.title == act.title && other.artist.eq_ignore_ascii_case(&act.artist)) {
        println!("{} is already at {} on {}", act.artist, act.title, act.watched_on);
        return Ok(());
    }
    shared_data::log_file::append(&acts_path(), &ACT_HEADER, "concert acts", [line])?;
    import(db)?;
    println!("added {} to {} on {}", act.artist, act.title, act.watched_on);
    Ok(())
}

/// The `add-concert-act` job: a line for a concert that is in the log, checked as the import checks it.
pub fn add_act(db: &SqliteClient, args: &Args) -> Result<()> {
    add_act_line(db, &field(args, 1), args.positional(0), &field(args, 2), &field(args, 3))
}

/// The `add-concert` job: a line built from `<title> <venue> <date>` and read back, so what `add` accepts is what the import accepts.
pub fn add(db: &SqliteClient, args: &Args) -> Result<()> {
    let line = vec![field(args, 2), args.positional(0).to_string(), field(args, 1)];
    let watch = CONCERTS.parse_line(&line).context("the concert to add")?;
    let count = CONCERTS.add(db, &path(), &watch)?;
    println!("added {} on {}; {count} concerts in all", watch.title, watch.watched_on.as_deref().unwrap_or("an unknown day"));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_act_is_a_day_a_concert_an_artist_and_a_billing() {
        let acts = read_acts("watched_on,title,artist,billing\n2017-07-12,Slottsfjell 2017,Tove Lo,\n2026-02-20,Carina Dahl,Support Act,support\n").unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!((acts.len(), acts[0].billing.as_deref(), acts[1].billing.as_deref()), (2, None, Some("support")));
        assert!(read_acts("watched_on,title,artist,billing\n2017-07-12,Slottsfjell 2017,Tove Lo,star\n").is_err());
    }

    #[test]
    fn an_album_is_a_day_a_concert_and_an_immich_id() {
        let albums = read_albums("watched_on,title,album_id\n2024-02-17,GIMS,abc\n").unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!(albums, vec![["2024-02-17".to_string(), "GIMS".to_string(), "abc".to_string()]]);
        assert!(read_albums("watched_on,title,album_id\n2024-02-17,GIMS,\n").is_err());
    }

    #[test]
    fn a_venue_is_a_text_and_a_place() {
        let venues = read_venues("venue,lat,lon\n\"SALT, Den Arktiske Hovedscena\",59.9,10.7\n").unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!(venues, vec![("SALT, Den Arktiske Hovedscena".to_string(), 59.9, 10.7)]);
        assert!(read_venues("venue,lat,lon\nX,95,10\n").is_err());
    }

    #[test]
    fn a_concert_line_is_a_day_an_event_and_a_venue() {
        let concerts = CONCERTS.read("watched_on,title,place\n2026-02-20,Carina Dahl,Rockefeller\n").unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!((concerts[0].watched_on.as_deref(), concerts[0].title.as_str(), concerts[0].place.as_deref()), (Some("2026-02-20"), "Carina Dahl", Some("Rockefeller")));
    }
}
