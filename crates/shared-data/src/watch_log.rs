//! The log a watch-log app keeps by hand, because there is no account to fetch the history from: one CSV file whose
//! lines are the record. `import` makes the app's watch table exactly the log's lines, so a line changed or deleted
//! in the file is changed or deleted in the database at the next import; `add` is the way to add a line without
//! opening the file.
//!
//! The file's columns are the app's choice — `title` or `series`, a cinema or nothing where a series' place comes
//! from the register, a season and an episode or not — and its `header` names them, so one `Watch` here reads,
//! checks and writes every watch-log app's file.

use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use chrono::NaiveDate;
use serde_json::{json, Value};

use crate::log_file;
use crate::job::Args;
use crate::sqlite_client::SqliteClient;

/// The non-empty text of a field, trimmed.
#[must_use]
pub fn blank(text: &str) -> Option<&str> {
    let text = text.trim();
    (!text.is_empty()).then_some(text)
}

/// An argument as a log field: `-` means it is left empty.
#[must_use]
pub fn field(args: &Args, index: usize) -> String {
    match args.positional(index) {
        "-" => String::new(),
        text => text.to_string(),
    }
}

/// A column a log can have, whatever the app calls the work or the place.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Column {
    WatchedOn,
    /// The work as the log writes it: `title` or `series`.
    Work,
    Year,
    Season,
    Episode,
    Rating,
    Rewatch,
    Note,
    TmdbId,
    /// The place the log writes itself, such as `cinema`; a series' network is the register's, not the log's.
    Place,
    /// Where in the hall a cinema viewing was sat, as the ticket says: `seat`.
    Seat,
    /// How the owner stands to the work, for a collection: `owned`, `want`.
    Status,
    /// What a music line is about: `artist`, `album` or `song`.
    Kind,
    Artist,
    /// MusicBrainz's number for a music line.
    Mbid,
    /// What the owner has of a collection's work: `cd`, `vinyl`, `digital`, `blu-ray`; free text.
    Format,
}

impl Column {
    /// The column a header names, or what is wrong with it.
    fn named(name: &str) -> Result<Self> {
        Ok(match name {
            "watched_on" | "added_on" => Self::WatchedOn,
            "title" | "series" => Self::Work,
            "year" => Self::Year,
            "season" => Self::Season,
            "episode" => Self::Episode,
            "rating" => Self::Rating,
            "rewatch" => Self::Rewatch,
            "note" => Self::Note,
            "tmdb_id" => Self::TmdbId,
            "cinema" | "place" => Self::Place,
            "seat" => Self::Seat,
            "status" => Self::Status,
            "kind" => Self::Kind,
            "artist" => Self::Artist,
            "mbid" => Self::Mbid,
            "format" => Self::Format,
            other => bail!("«{other}» is not a column a log has"),
        })
    }
}

/// A `watched_on` field: a `YYYY-MM-DD` day, or none when it is empty. A day written another way is refused.
pub fn parse_watched_on(text: &str) -> Result<Option<String>> {
    let Some(day) = blank(text) else { return Ok(None) };
    NaiveDate::parse_from_str(day, "%Y-%m-%d").with_context(|| format!("«{day}» is not a date written YYYY-MM-DD"))?;
    Ok(Some(day.to_string()))
}

/// A `date` field that may carry the moment: a `YYYY-MM-DD` day, or an RFC 3339 instant such as `2026-10-28T11:29:00Z`
/// (the day is the date as written, the moment Unix seconds). Anything else is refused.
pub fn parse_moment(text: &str) -> Result<(Option<String>, Option<i64>)> {
    let Some(text) = blank(text) else { return Ok((None, None)) };
    if text.len() > 10 {
        let at = chrono::DateTime::parse_from_rfc3339(text).with_context(|| format!("«{text}» is not a day written YYYY-MM-DD or a moment written like 2026-10-28T11:29:00Z"))?;
        return Ok((Some(at.date_naive().to_string()), Some(at.timestamp())));
    }
    Ok((parse_watched_on(text)?, None))
}

/// A year field, or none when it is empty.
pub fn parse_year(text: &str) -> Result<Option<i64>> {
    let Some(text) = blank(text) else { return Ok(None) };
    Ok(Some(text.parse::<i64>().with_context(|| format!("«{text}» is not a year"))?))
}

/// A rating field from 0.5 to 5 in half steps, or none when it is empty.
pub fn parse_rating(text: &str) -> Result<Option<f64>> {
    let Some(text) = blank(text) else { return Ok(None) };
    let value = text.replace(',', ".").parse::<f64>().with_context(|| format!("«{text}» is not a rating"))?;
    if !(0.5..=5.0).contains(&value) || (value * 2.0).fract() != 0.0 {
        bail!("the rating {text} is not from 0.5 to 5 in half steps");
    }
    Ok(Some(value))
}

/// A `rewatch` field: whether the work had been seen before.
fn parse_rewatch(text: &str) -> Result<bool> {
    match blank(text).map(str::to_lowercase).as_deref() {
        None | Some("0" | "nei" | "no" | "false") => Ok(false),
        Some("1" | "ja" | "yes" | "true") => Ok(true),
        Some(other) => bail!("«{other}» is not 0 or 1 for rewatch"),
    }
}

/// A number field, or none when it is empty. `what` names it in the error.
fn parse_number(text: &str, what: &str) -> Result<Option<i64>> {
    let Some(text) = blank(text) else { return Ok(None) };
    Ok(Some(text.parse::<i64>().with_context(|| format!("«{text}» is not a {what}"))?))
}

/// A season or episode number: a count from 1 up (0 is the register's specials, which a log does not use).
fn parse_count(text: &str, what: &str) -> Result<Option<i64>> {
    match parse_number(text, what)? {
        Some(value) if value < 1 => bail!("a {what} is 1 or more"),
        other => Ok(other),
    }
}

/// One line of a log: what every watch-log app records, however many of these its own header names.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Watch {
    /// `YYYY-MM-DD`, or none when the day is not known.
    pub watched_on: Option<String>,
    /// The work as the log writes it: a film's title, a series' name.
    pub title: String,
    pub year: Option<i64>,
    /// The season and the episode within it, or none when the whole work was watched as such.
    pub season: Option<i64>,
    pub episode: Option<i64>,
    pub rating: Option<f64>,
    pub rewatch: bool,
    pub note: Option<String>,
    pub tmdb_id: Option<i64>,
    /// The place the log itself writes, such as a cinema, or none when the log has no such column.
    pub place: Option<String>,
    /// Where in the hall it was sat, or none when the log has no such column or the line has no seat.
    pub seat: Option<String>,
    /// How the owner stands to the work, for a collection (`owned`, `want`), or none when the log has no such column.
    pub status: Option<String>,
    /// `artist`, `album` or `song`, and who made it, for a music line; the title is empty for an artist.
    pub kind: Option<String>,
    pub artist: Option<String>,
    pub mbid: Option<String>,
    /// What the owner has, lowercase as the collection's line writes it, or none.
    pub format: Option<String>,
}

/// One log file: the columns of a line in order, the table its lines fill, and what to call the file in an error.
#[derive(Debug, Clone, Copy)]
pub struct Log {
    pub header: &'static [&'static str],
    pub table: &'static str,
    /// The file's name in a message: `film log`, `tv log`.
    pub name: &'static str,
    /// The command that writes the file, for the message when there is none yet.
    pub made_by: &'static str,
    /// The statuses a collection's line may have, the first being what an empty one means; none for a log of viewings.
    pub statuses: &'static [&'static str],
}

impl Log {
    /// Every line of the log's text, the header line skipped; a wrong line is refused with its line number.
    pub fn read(&self, text: &str) -> Result<Vec<Watch>> {
        let mut reader = csv::ReaderBuilder::new().has_headers(false).comment(Some(b'#')).flexible(true).from_reader(text.as_bytes());
        let mut watches = Vec::new();
        for (index, record) in reader.records().enumerate() {
            let record = record.with_context(|| format!("reading record {} of the {}", index + 1, self.name))?;
            let fields: Vec<String> = record.iter().map(str::to_string).collect();
            if index == 0 && fields.first().is_some_and(|first| first.trim() == self.header[0]) {
                continue;
            }
            let line = record.position().map_or(index + 1, |position| usize::try_from(position.line()).unwrap_or(index + 1));
            watches.push(self.parse_line(&fields).with_context(|| format!("line {line} of the {}", self.name))?);
        }
        Ok(watches)
    }

    /// One record, read column by column as the header names them.
    pub fn parse_line(&self, fields: &[String]) -> Result<Watch> {
        let mut watch = Watch::default();
        for (index, name) in self.header.iter().enumerate() {
            let field = fields.get(index).map(String::as_str).unwrap_or_default();
            match Column::named(name)? {
                Column::WatchedOn => watch.watched_on = parse_watched_on(field)?,
                Column::Work => watch.title = blank(field).unwrap_or_default().to_string(),
                Column::Year => watch.year = parse_year(field)?,
                Column::Season => watch.season = parse_count(field, "season")?,
                Column::Episode => watch.episode = parse_count(field, "episode")?,
                Column::Rating => watch.rating = parse_rating(field)?,
                Column::Rewatch => watch.rewatch = parse_rewatch(field)?,
                Column::Note => watch.note = blank(field).map(str::to_string),
                Column::TmdbId => watch.tmdb_id = parse_number(field, "TMDB number")?,
                Column::Place => watch.place = blank(field).map(str::to_string),
                Column::Seat => watch.seat = blank(field).map(str::to_string),
                Column::Status => watch.status = Some(blank(field).unwrap_or(self.statuses.first().copied().unwrap_or_default()).to_string()),
                Column::Kind => watch.kind = blank(field).map(str::to_string),
                Column::Artist => watch.artist = blank(field).map(str::to_string),
                Column::Mbid => watch.mbid = blank(field).map(str::to_string),
                Column::Format => watch.format = blank(field).map(str::to_lowercase),
            }
        }
        self.check(&watch)?;
        Ok(watch)
    }

    /// What a line must have: a title (an artist's line has none), a status the collection knows, a music kind.
    fn check(&self, watch: &Watch) -> Result<()> {
        let music = self.header.contains(&"artist");
        if music {
            let kind = watch.kind.as_deref().context("the kind is empty")?;
            if !["artist", "album", "song"].contains(&kind) {
                bail!("«{kind}» is not artist, album or song");
            }
            watch.artist.as_deref().context("the artist is empty")?;
            if kind != "artist" && watch.title.is_empty() {
                bail!("an {kind} needs a title");
            }
        } else if watch.title.is_empty() {
            bail!("the {} is empty", self.work_column());
        }
        if let Some(status) = watch.status.as_deref() {
            if !self.statuses.contains(&status) {
                bail!("«{status}» is not a status: {}", self.statuses.join(", "));
            }
        }
        Ok(())
    }

    /// The row the table takes, a property per column.
    pub fn values(&self, watch: &Watch) -> Result<Vec<Value>> {
        self.header
            .iter()
            .map(|name| {
                Ok(match Column::named(name)? {
                    Column::WatchedOn => json!(watch.watched_on),
                    Column::Work => json!(watch.title),
                    Column::Year => json!(watch.year),
                    Column::Season => json!(watch.season),
                    Column::Episode => json!(watch.episode),
                    Column::Rating => json!(watch.rating),
                    Column::Rewatch => json!(i64::from(watch.rewatch)),
                    Column::Note => json!(watch.note),
                    Column::TmdbId => json!(watch.tmdb_id),
                    Column::Place => json!(watch.place),
                    Column::Seat => json!(watch.seat),
                    Column::Status => json!(watch.status),
                    Column::Kind => json!(watch.kind),
                    Column::Artist => json!(watch.artist),
                    Column::Mbid => json!(watch.mbid),
                    Column::Format => json!(watch.format),
                })
            })
            .collect()
    }

    /// The line the log writes, a field per column: nothing for what is not there, and a flag as `1`.
    pub fn line(&self, watch: &Watch) -> Result<Vec<String>> {
        let rewatch = if watch.rewatch { "1".to_string() } else { String::new() };
        self.header
            .iter()
            .zip(self.values(watch)?)
            .map(|(name, value)| {
                Ok(match (value, Column::named(name)?) {
                    (Value::Null, _) => String::new(),
                    (Value::String(text), _) => text,
                    (_, Column::Rewatch) => rewatch.clone(),
                    (other, _) => other.to_string(),
                })
            })
            .collect()
    }

    /// The column that names the work: `title` or `series`.
    fn work_column(&self) -> &'static str {
        self.header.iter().find(|column| **column == "title" || **column == "series").copied().unwrap_or("title")
    }

    /// The log's text, telling how to make the file when there is none.
    pub fn read_file(&self, path: &Path) -> Result<String> {
        log_file::read(path, self.made_by)
    }

    /// Makes the table the log's lines and nothing else.
    pub fn replace(&self, db: &SqliteClient, watches: &[Watch]) -> Result<usize> {
        let rows = watches.iter().map(|watch| self.values(watch)).collect::<Result<Vec<_>>>()?;
        log_file::replace(db, self.table, self.header, rows, self.name)?;
        Ok(watches.len())
    }

    /// Adds one already-checked line to the file, with the header first when the file is new.
    pub fn append(&self, path: &Path, watch: &Watch) -> Result<()> {
        log_file::append(path, self.header, self.name, [self.line(watch)?])
    }

    /// Makes the table exactly the log's lines.
    pub fn import(&self, db: &SqliteClient, path: &Path) -> Result<usize> {
        let text = self.read_file(path)?;
        let watches = self.read(&text)?;
        self.replace(db, &watches)
    }

    /// The `import-log` job every watch-log tool has: import the file and report how many lines it had.
    pub fn import_log(&self, db: &SqliteClient, path: &Path) -> Result<()> {
        println!("import-log: {} viewings", self.import(db, path)?);
        Ok(())
    }

    /// Appends one line to the log and imports it.
    pub fn add(&self, db: &SqliteClient, path: &Path, watch: &Watch) -> Result<usize> {
        self.append(path, watch)?;
        self.import(db, path)
    }

    /// Sets the year and the place on the one line of `title` and `day` (`-` for a line with no day), leaving the file's
    /// other lines, comments included, byte for byte as they were, and imports it. A field given as `None` is left as it is.
    pub fn amend(&self, db: &SqliteClient, path: &Path, title: &str, day: &str, year: Option<&str>, place: Option<&str>) -> Result<usize> {
        let column = |wanted: Column| self.header.iter().position(|name| Column::named(name).ok() == Some(wanted));
        self.rewrite(db, path, title, day, |mut fields| {
            for (wanted, value) in [(Column::Year, year), (Column::Place, place)] {
                if let (Some(at), Some(value)) = (column(wanted), value) {
                    fields[at] = value.to_string();
                }
            }
            Some(fields)
        })
    }

    /// Sets the seat on the one line of `title` and `day` (`-` for a line with no day), the rest of the file untouched, and imports it.
    pub fn set_seat(&self, db: &SqliteClient, path: &Path, title: &str, day: &str, seat: &str) -> Result<usize> {
        let at = self.header.iter().position(|name| Column::named(name).ok() == Some(Column::Seat)).context("the log has no seat column")?;
        self.rewrite(db, path, title, day, |mut fields| {
            fields[at] = seat.to_string();
            Some(fields)
        })
    }

    /// Takes the one line of `title` and `day` (`-` for a line with no day) out of the file, the rest untouched, and imports it.
    pub fn remove(&self, db: &SqliteClient, path: &Path, title: &str, day: &str) -> Result<usize> {
        self.rewrite(db, path, title, day, |_| None)
    }

    /// Replaces the one line of `title` and `day` with what `change` makes of its fields, or drops it for `None`.
    fn rewrite(&self, db: &SqliteClient, path: &Path, title: &str, day: &str, change: impl Fn(Vec<String>) -> Option<Vec<String>>) -> Result<usize> {
        let column = |wanted: Column| self.header.iter().position(|name| Column::named(name).ok() == Some(wanted));
        let (title_at, day_at) = (column(Column::Work).context("the log has no title column")?, column(Column::WatchedOn).context("the log has no day column")?);
        let wanted_day = if day == "-" { "" } else { day };
        let text = self.read_file(path)?;
        let mut found = 0;
        let mut lines = Vec::new();
        for line in text.split_inclusive('\n') {
            let fields: Vec<String> = if line.starts_with('#') { Vec::new() } else { csv::ReaderBuilder::new().has_headers(false).flexible(true).from_reader(line.as_bytes()).records().next().and_then(Result::ok).map(|record| record.iter().map(str::to_string).collect()).unwrap_or_default() };
            if fields.get(title_at).is_some_and(|found_title| found_title.trim() == title) && fields.get(day_at).is_some_and(|found_day| found_day.trim() == wanted_day) {
                found += 1;
                let mut fields = fields;
                fields.resize(self.header.len(), String::new());
                if let Some(fields) = change(fields) {
                    self.parse_line(&fields).with_context(|| format!("the changed line of {title}"))?;
                    let mut writer = csv::WriterBuilder::new().terminator(csv::Terminator::Any(b'\n')).from_writer(Vec::new());
                    writer.write_record(&fields)?;
                    lines.push(String::from_utf8(writer.into_inner()?)?);
                }
            } else {
                lines.push(line.to_string());
            }
        }
        if found != 1 {
            bail!("expected one line for «{title}» on {day} in the {}, found {found}", self.name);
        }
        std::fs::write(path, lines.concat()).with_context(|| format!("writing {}", path.display()))?;
        self.import(db, path)
    }

    /// The works the log names with no register number yet, each with its year (0 for none), for the register to look
    /// up.
    #[must_use]
    pub fn unresolved(&self, db: &SqliteClient) -> Vec<(String, i64)> {
        let column = self.work_column();
        let sql = format!("SELECT DISTINCT {column} AS title, COALESCE(year, 0) AS year FROM {} WHERE tmdb_id IS NULL ORDER BY {column}", self.table);
        db.query(&sql, &[]).unwrap_or_default().iter().filter_map(|row: &Value| Some((row["title"].as_str()?.to_string(), row["year"].as_i64()?))).collect()
    }

    /// A log path under the temporary directory, for a test that writes a file nobody keeps.
    #[must_use]
    pub fn temp_path(&self, tag: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!("log-{tag}-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&directory);
        directory.join("log.csv")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A film-shaped log: a title, a rating to 5 and the cinema it was seen in.
    const FILMS: Log = Log {
        header: &["watched_on", "title", "year", "rating", "rewatch", "note", "tmdb_id", "cinema"],
        table: "film_watch",
        name: "film log",
        made_by: "film-sync add <title> <year> <date> <rating>",
        statuses: &[],
    };

    /// A series-shaped log: a name, a season and an episode, no place of its own.
    const SERIES: Log = Log {
        header: &["watched_on", "series", "year", "season", "episode", "rating", "rewatch", "note", "tmdb_id"],
        table: "tv_watch",
        name: "tv log",
        made_by: "tv-sync add <series> <year> <season> <episode> <date> <rating>",
        statuses: &[],
    };

    const FILM_LOG: &str = "# my films\nwatched_on,title,year,rating,rewatch,note,tmdb_id,cinema\n2026-10-01,Aftersun,2022,4.5,,\"Slow, and sad\",,Cinemateket\n2026-10-02,\"Heat\",1995,4,1,,949\n2026-10-03,Parasite,,,,,\n";

    /// The two tables the tests read, as thin as the logs they hold.
    const SCHEMA: &str = "
        CREATE TABLE film_watch (id INTEGER PRIMARY KEY, watched_on TEXT, title TEXT NOT NULL, year INTEGER, rating REAL, rewatch INTEGER NOT NULL, note TEXT, tmdb_id INTEGER, cinema TEXT, seat TEXT);
        CREATE TABLE tv_watch (id INTEGER PRIMARY KEY, watched_on TEXT, series TEXT NOT NULL, year INTEGER, season INTEGER, episode INTEGER, rating REAL, rewatch INTEGER NOT NULL, note TEXT, tmdb_id INTEGER);
    ";

    fn db() -> SqliteClient {
        crate::app_db::memory_with_schema(SCHEMA)
    }

    fn watch() -> Watch {
        Watch { watched_on: Some("2026-10-05".into()), title: "Heat, the film".into(), year: Some(1995), season: Some(2), episode: Some(3), rating: Some(4.0), rewatch: true, note: Some("a note".into()), tmdb_id: Some(949), place: Some("Vika".into()), ..Watch::default() }
    }

    #[test]
    fn a_line_is_read_by_the_columns_its_own_log_names() {
        let films = FILMS.read(FILM_LOG).unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!(films.len(), 3);
        assert_eq!((films[0].title.as_str(), films[0].year, films[0].rating, films[0].rewatch, films[0].note.as_deref(), films[0].place.as_deref()), ("Aftersun", Some(2022), Some(4.5), false, Some("Slow, and sad"), Some("Cinemateket")));
        assert_eq!((films[1].rewatch, films[1].tmdb_id, films[1].place.as_deref()), (true, Some(949), None));
        assert_eq!((films[2].year, films[2].rating, films[2].tmdb_id, films[2].watched_on.as_deref()), (None, None, None, Some("2026-10-03")));
        let episodes = SERIES.read("watched_on,series,year,season,episode,rating,rewatch,note,tmdb_id\n2026-10-01,\"The Bear\",2022,1,1,4.5,,\"Pilot\",\n").unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!((episodes[0].title.as_str(), episodes[0].season, episodes[0].episode, episodes[0].note.as_deref(), episodes[0].place.as_deref()), ("The Bear", Some(1), Some(1), Some("Pilot"), None));
    }

    #[test]
    fn a_line_written_back_is_the_line_it_was_read_from() {
        let films = FILMS.read("watched_on,title,year,rating,rewatch,note,tmdb_id,cinema\n2026-10-01,\"Aftersun\",2022,4.5,,\"a, b\",,Cinemateket\n").unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!(FILMS.line(&films[0]).unwrap_or_default(), vec!["2026-10-01", "Aftersun", "2022", "4.5", "", "a, b", "", "Cinemateket"]);
        // A log without a season, an episode or a place leaves those fields out of its line.
        assert_eq!(FILMS.line(&watch()).unwrap_or_default().len(), 8);
        assert_eq!(SERIES.line(&watch()).unwrap_or_default().len(), 9);
        assert_eq!(SERIES.values(&watch()).unwrap_or_default()[3], json!(Some(2)));
        assert_eq!(FILMS.values(&watch()).unwrap_or_default()[7], json!("Vika"));
    }

    #[test]
    fn a_wrong_line_is_refused_with_its_line_number_and_what_is_wrong() {
        for (line, wrong) in [("2026-13-01,A,2000,,,,", "not a date"), ("2026-01-01,,2000,,,,", "title is empty"), ("2026-01-01,A,abc,,,,", "not a year"), ("2026-01-01,A,2000,6,,,", "half steps"), ("2026-01-01,A,2000,3.3,,,", "half steps"), ("2026-01-01,A,2000,,maybe,,", "rewatch")] {
            let error = format!("{:#}", FILMS.read(&format!("{}\n{line}\n", FILMS.header.join(","))).err().unwrap_or_else(|| panic!("{line} was accepted")));
            assert!(error.contains("line 2") && error.contains(wrong), "{line}: {error}");
        }
        for (line, wrong) in [("2026-01-01,A,2022,0,1,,,", "season"), ("2026-01-01,A,2022,-1,1,,,", "season"), ("2026-01-01,A,2022,1,0,,,", "episode")] {
            let error = format!("{:#}", SERIES.read(&format!("{}\n{line}\n", SERIES.header.join(","))).err().unwrap_or_else(|| panic!("{line} was accepted")));
            assert!(error.contains("line 2") && error.contains(wrong), "{line}: {error}");
        }
    }

    #[test]
    fn a_column_no_log_has_is_refused() {
        const TYPO: Log = Log { header: &["watched_on", "series", "seasons", "rewatch"], table: "tv_watch", name: "tv log", made_by: "nothing", statuses: &[] };
        let error = format!("{:#}", TYPO.parse_line(&["2026-01-01".to_string(), "A".to_string()]).err().unwrap_or_else(|| panic!("a wrong column was accepted")));
        assert!(error.contains("is not a column"), "{error}");
    }

    #[test]
    fn importing_twice_leaves_the_log_and_a_line_removed_from_it_is_removed_here() {
        let db = db();
        let path = FILMS.temp_path("film");
        std::fs::write(&path, FILM_LOG).unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(FILMS.import(&db, &path).unwrap_or_else(|error| panic!("{error:#}")), 3);
        assert_eq!(FILMS.import(&db, &path).unwrap_or_else(|error| panic!("{error:#}")), 3);
        // A viewing with no day is kept without one, and the third film's line is gone from both.
        std::fs::write(&path, ",Iron Man,2008,,,,,\n").unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(FILMS.import(&db, &path).unwrap_or_else(|error| panic!("{error:#}")), 1);
        let rows = db.query("SELECT title, watched_on FROM film_watch", &[]).unwrap_or_default();
        assert_eq!((rows[0]["title"].clone(), rows[0]["watched_on"].clone()), (json!("Iron Man"), Value::Null));
        assert_eq!(FILMS.unresolved(&db), vec![("Iron Man".to_string(), 2008)]);
    }

    #[test]
    fn a_line_added_is_a_line_the_log_reads_back_and_the_file_gets_its_header_once() {
        let db = db();
        let path = SERIES.temp_path("tv");
        let _ = std::fs::remove_file(&path);
        let watch = watch();
        SERIES.add(&db, &path, &watch).unwrap_or_else(|error| panic!("{error:#}"));
        SERIES.add(&db, &path, &watch).unwrap_or_else(|error| panic!("{error:#}"));
        let text = std::fs::read_to_string(&path).unwrap_or_default();
        assert_eq!(text.matches("watched_on").count(), 1);
        // The tv log has no cinema, so the place it was given is not one of its columns and comes back empty.
        let expected = Watch { place: None, ..watch };
        assert_eq!(SERIES.read(&text).unwrap_or_else(|error| panic!("{error:#}")), vec![expected.clone(), expected]);
        assert_eq!(db.query("SELECT count(*) AS n FROM tv_watch", &[]).unwrap_or_default()[0]["n"], json!(2));
    }

    #[test]
    fn reading_a_file_that_is_not_there_says_how_to_make_it() {
        let error = format!("{:#}", FILMS.read_file(Path::new("/nonexistent/log.csv")).err().unwrap_or_else(|| panic!("a missing file was read")));
        assert!(error.contains("film-sync add <title> <year> <date> <rating>"), "{error}");
    }

    #[test]
    fn a_line_is_amended_or_removed_alone_and_the_rest_of_the_file_is_left_as_it_was() {
        let path = std::env::temp_dir().join(format!("watch-log-rewrite-{}.csv", std::process::id()));
        let original = "watched_on,title,year,rating,rewatch,note,tmdb_id,cinema\n# kept, as written\n,Longlegs,2024,,,,,\n2024-08-05,Longlegs,,,,,,\n2024-09-30,Armand,,,,,,\n";
        std::fs::write(&path, original).unwrap_or_else(|error| panic!("{error}"));
        let db = db();
        FILMS.amend(&db, &path, "Longlegs", "2024-08-05", Some("2024"), Some("Vega kino")).unwrap_or_else(|error| panic!("{error:#}"));
        FILMS.remove(&db, &path, "Longlegs", "-").unwrap_or_else(|error| panic!("{error:#}"));
        let text = std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(text, "watched_on,title,year,rating,rewatch,note,tmdb_id,cinema\n# kept, as written\n2024-08-05,Longlegs,2024,,,,,Vega kino\n2024-09-30,Armand,,,,,,\n");
        assert!(FILMS.remove(&db, &path, "Longlegs", "-").is_err(), "a line that is not there is an error, not a silent pass");
        std::fs::remove_file(&path).unwrap_or_else(|error| panic!("{error}"));
    }

    /// A film collection: what the owner has or wants, with no viewings.
    const COLLECTION: Log = Log {
        header: &["added_on", "title", "year", "status", "rating", "note", "tmdb_id", "format"],
        table: "film_collection",
        name: "film collection",
        made_by: "write film-collection.csv by hand",
        statuses: &["owned", "want"],
    };

    /// A music collection: an artist, an album or a song a line.
    const MUSIC: Log = Log {
        header: &["added_on", "kind", "artist", "title", "year", "status", "rating", "note", "mbid", "format"],
        table: "music_collection",
        name: "music collection",
        made_by: "write music-collection.csv by hand",
        statuses: &["owned", "want"],
    };

    #[test]
    fn a_collection_line_has_a_status_that_is_owned_unless_the_line_says_another() {
        let lines = COLLECTION.read("added_on,title,year,status,rating,note,tmdb_id\n2026-01-01,Heat,1995,,,,949\n,Alien,1979,want,,,\n").unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!(lines.iter().map(|line| line.status.as_deref()).collect::<Vec<_>>(), vec![Some("owned"), Some("want")]);
        let error = format!("{:#}", COLLECTION.read("added_on,title,year,status,rating,note,tmdb_id\n,Heat,1995,loved,,,\n").err().unwrap_or_else(|| panic!("a bad status was read")));
        assert!(error.contains("not a status") && error.contains("line 2"), "{error}");
    }

    #[test]
    fn a_music_line_needs_a_kind_and_an_artist_and_a_title_unless_it_is_an_artist() {
        let text = "added_on,kind,artist,title,year,status,rating,note,mbid\n,artist,Robyn,,,,,,\n2025-05-05,album,Robyn,Honey,2018,owned,4.5,,\n";
        let formats = MUSIC.read("added_on,kind,artist,title,year,status,rating,note,mbid,format\n,album,Beyoncé,Renaissance,2022,owned,,,,CD\n").unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!(formats[0].format.as_deref(), Some("cd"));
        let lines = MUSIC.read(text).unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!((lines[0].kind.as_deref(), lines[0].title.as_str(), lines[1].title.as_str()), (Some("artist"), "", "Honey"));
        for bad in [",album,Robyn,,,,,,\n", ",single,Robyn,Honey,,,,,\n", ",song,,Honey,,,,,\n"] {
            assert!(MUSIC.read(&format!("added_on,kind,artist,title,year,status,rating,note,mbid\n{bad}")).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_seat_is_read_set_on_the_one_line_and_written_to_the_table() {
        let with_seat = Log { header: &["watched_on", "title", "year", "rating", "rewatch", "note", "tmdb_id", "cinema", "seat"], ..FILMS };
        let db = db();
        let path = with_seat.temp_path("seat");
        std::fs::write(&path, "watched_on,title,year,rating,rewatch,note,tmdb_id,cinema,seat\n# kept\n2026-11-05,Heat,1995,,,,,Ringen\n2026-11-06,Alien,,,,,,Ringen,Sal 2\n").unwrap();
        with_seat.import(&db, &path).unwrap();
        with_seat.set_seat(&db, &path, "Heat", "2026-11-05", "Sal 1, rad 10, sete 7").unwrap();
        let rows = db.query("SELECT title, seat FROM film_watch ORDER BY title", &[]).unwrap_or_default();
        assert_eq!(rows[0]["seat"], "Sal 2");
        assert_eq!(rows[1]["seat"], "Sal 1, rad 10, sete 7");
        assert!(std::fs::read_to_string(&path).unwrap().contains("# kept\n2026-11-05,Heat,1995,,,,,Ringen,\"Sal 1, rad 10, sete 7\"\n"));
        assert!(FILMS.set_seat(&db, &path, "Heat", "2026-11-05", "x").is_err());
    }
}
