//! What the games, books and board games apps share: the log the owner keeps (one CSV file whose lines are the
//! record, plus what a service adds to it), the register tables each keeps (`<prefix>_item`, `_genre`, `_match`) and
//! how a title and year find its place in a register. A source of an app only says how to search its register and how
//! to read an answer; everything that touches the log or the tables is here, so the three tools cannot drift apart.
//!
//! The log's columns are the same in every one: `date,title,year,status,rating,amount,note,ext_id`. `amount` is hours
//! for a game and pages for a book; `ext_id` is the register's number, which settles a wrong match when the owner
//! writes it in.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};

use crate::app_db::{open_migrated, path_from_env};
use crate::batch::insert_statements;
use crate::log_file;
use crate::job::{run_from_argv, Args, Job};
use crate::sqlite_client::SqliteClient;
use crate::text::normalize;
use crate::watch_log::{blank, parse_moment, parse_rating, parse_year};

/// The columns of the log, and of `<prefix>_entry` (where `date` is `on_date`, because `on` is SQL's).
pub const HEADER: [&str; 10] = ["date", "title", "year", "status", "rating", "amount", "note", "ext_id", "source", "format"];
pub const ENTRY_COLUMNS: [&str; 11] = ["on_date", "title", "year", "status", "rating", "amount", "note", "ext_id", "source", "format", "at"];
/// The words a line of the collection may use; an empty status is the first.
pub const COLLECTION_STATUSES: [&str; 2] = ["owned", "want"];
/// The candidates a search with no sure answer leaves for the owner to choose from.
const CANDIDATES_KEPT: usize = 5;

/// One line of the log.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Entry {
    /// `YYYY-MM-DD`, or none when the day is not known. With `at`, the day of it (UTC).
    pub on_date: Option<String>,
    /// The moment, in Unix seconds, where the source knows it; the log writes it as an RFC 3339 instant in `date`.
    pub at: Option<i64>,
    pub title: String,
    pub year: Option<i64>,
    pub status: String,
    /// 0.5 to 5 in half steps.
    pub rating: Option<f64>,
    pub amount: Option<f64>,
    pub note: Option<String>,
    pub ext_id: Option<String>,
    /// The service's own number for the line, such as `steam:553420`.
    pub source: Option<String>,
    /// What the owner has when the status says owned: `cd`, `vinyl`, `digital`, `fysisk`, a platform; free text, shown as written.
    pub format: Option<String>,
}

/// One work as a register has it.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Item {
    pub ext_id: String,
    pub title: String,
    pub creator: Option<String>,
    pub year: Option<i64>,
    pub summary: Option<String>,
    pub cover: Option<String>,
    /// A wide picture for behind the work's page: a game's screenshot, a book's author.
    pub banner: Option<String>,
    pub url: Option<String>,
    pub genres: Vec<String>,
}

/// One result of a search in a register.
#[derive(Debug, Clone, PartialEq)]
pub struct Hit {
    pub ext_id: String,
    pub title: String,
    pub year: Option<i64>,
    /// Whatever the register ranks by; the most popular of the equal titles wins.
    pub popularity: f64,
}

/// What a search came to: the work's number, or the candidates to choose from.
#[derive(Debug, Clone, PartialEq)]
pub enum Found {
    Number(String),
    Candidates(Vec<Hit>),
}

/// Release years differ by a few between a log, a platform and a register (early access, a re-release); further apart is another work.
const YEARS_APART: i64 = 5;

/// A title as works are compared by: «Baldur's Gate III» and «Baldur's Gate 3» are equal, as are two spellings with other accents or case.
fn comparable(title: &str) -> String {
    let numbers = [("II", "2"), ("III", "3"), ("IV", "4"), ("V", "5"), ("VI", "6"), ("VII", "7"), ("VIII", "8"), ("IX", "9"), ("X", "10")];
    let words: Vec<&str> = title.split(' ').map(|word| numbers.iter().find(|(roman, _)| *roman == word).map_or(word, |(_, digits)| digits)).collect();
    normalize(&words.join(" "))
}

/// The work a title and year name among a search's hits: the title must be the same and the year too, when there is
/// one and the hit has one, within a few years (the exact year first, then the most popular). None of them gives the
/// first few hits to choose from.
#[must_use]
pub fn pick(hits: &[Hit], title: &str, year: i64) -> Found {
    let wanted = comparable(title);
    let mut same: Vec<&Hit> = hits
        .iter()
        .filter(|hit| comparable(&hit.title) == wanted && (year == 0 || hit.year.is_some_and(|found| (found - year).abs() <= YEARS_APART)))
        .collect();
    same.sort_by(|a, b| (b.year == Some(year)).cmp(&(a.year == Some(year))).then(b.popularity.total_cmp(&a.popularity)));
    match same.first() {
        Some(hit) => Found::Number(hit.ext_id.clone()),
        None => Found::Candidates(hits.iter().take(CANDIDATES_KEPT).cloned().collect()),
    }
}

/// The title before its subtitle or its bracket («Manufacturing Consent: The Political Economy…», «Black Skin, White Masks (Penguin Modern Classics)»), or none when it has neither.
fn main_title(title: &str) -> Option<String> {
    let end = title.find([':', '(']).filter(|end| *end > 0)?;
    let main = title[..end].trim();
    (!main.is_empty() && main.len() < title.len()).then(|| main.to_string())
}

/// An amount of hours or pages: zero or more.
fn parse_amount(text: &str) -> Result<Option<f64>> {
    let Some(text) = blank(text) else { return Ok(None) };
    let value = text.replace(',', ".").parse::<f64>().with_context(|| format!("«{text}» is not an amount"))?;
    if !value.is_finite() || value < 0.0 {
        bail!("the amount {text} is not zero or more");
    }
    Ok(Some(value))
}

/// Which of an app's two files and tables: the log of what was played or read, or the collection of what is owned or wanted.
/// They have the same columns, so one reader and one writer serve both.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ledger {
    Log,
    Collection,
}

impl Ledger {
    fn kind(self) -> &'static str {
        match self {
            Self::Log => "entry",
            Self::Collection => "collection",
        }
    }
}

/// One app's log and register: the tables are named for `prefix`, and `statuses` are the words the log may use.
#[derive(Debug, Clone, Copy)]
pub struct Shelf {
    /// `game`, `book`, `boardgame`: `<prefix>_entry`, `<prefix>_item`, `<prefix>_genre`, `<prefix>_match`.
    pub prefix: &'static str,
    /// The file's name in a message: `games log`.
    pub name: &'static str,
    /// The words a line of the log may use; an empty status is the first.
    pub statuses: &'static [&'static str],
    /// The status of a line `add` writes.
    pub added_as: &'static str,
    /// What a source that wins over the log does to the tables after every import (Hardcover's shelves, for books).
    pub overlay: Option<fn(&SqliteClient) -> Result<()>>,
    /// The command that writes the file, for the message when there is none yet.
    pub made_by: &'static str,
}

impl Shelf {
    fn table(&self, kind: &str) -> String {
        format!("{}_{kind}", self.prefix)
    }

    /// Every line of the log's text, the header line skipped; a wrong line is refused with its line number.
    pub fn read(&self, text: &str) -> Result<Vec<Entry>> {
        self.read_in(Ledger::Log, text)
    }

    /// The same for the text of either file.
    pub fn read_in(&self, ledger: Ledger, text: &str) -> Result<Vec<Entry>> {
        let mut reader = csv::ReaderBuilder::new().has_headers(false).comment(Some(b'#')).flexible(true).from_reader(text.as_bytes());
        let mut entries = Vec::new();
        for (index, record) in reader.records().enumerate() {
            let record = record.with_context(|| format!("reading record {} of the {}", index + 1, self.file_name(ledger)))?;
            let fields: Vec<String> = record.iter().map(str::to_string).collect();
            if index == 0 && fields.first().is_some_and(|first| first.trim() == HEADER[0]) {
                continue;
            }
            let line = record.position().map_or(index + 1, |position| usize::try_from(position.line()).unwrap_or(index + 1));
            entries.push(self.parse_line_in(ledger, &fields).with_context(|| format!("line {line} of the {}", self.file_name(ledger)))?);
        }
        Ok(entries)
    }

    /// What a file is called in a message.
    fn file_name(&self, ledger: Ledger) -> String {
        match ledger {
            Ledger::Log => self.name.to_string(),
            Ledger::Collection => format!("{} collection", self.prefix),
        }
    }

    /// One record of the log, read column by column.
    pub fn parse_line(&self, fields: &[String]) -> Result<Entry> {
        self.parse_line_in(Ledger::Log, fields)
    }

    /// One record of either file.
    pub fn parse_line_in(&self, ledger: Ledger, fields: &[String]) -> Result<Entry> {
        let statuses = if ledger == Ledger::Log { self.statuses } else { &COLLECTION_STATUSES };
        let field = |index: usize| fields.get(index).map(String::as_str).unwrap_or_default();
        let status = match blank(field(3)) {
            None => statuses.first().copied().unwrap_or_default().to_string(),
            Some(word) if statuses.contains(&word) => word.to_string(),
            Some(word) => bail!("«{word}» is not a status here: use {}", statuses.join(", ")),
        };
        let (on_date, at) = parse_moment(field(0))?;
        Ok(Entry {
            on_date,
            at,
            title: blank(field(1)).context("the title is empty")?.to_string(),
            year: parse_year(field(2))?,
            status,
            rating: parse_rating(field(4))?,
            amount: parse_amount(field(5))?,
            note: blank(field(6)).map(str::to_string),
            ext_id: blank(field(7)).map(str::to_string),
            source: blank(field(8)).map(str::to_string),
            format: blank(field(9)).map(str::to_lowercase),
        })
    }

    /// The row the table takes, a property per column.
    #[must_use]
    pub fn values(entry: &Entry) -> Vec<Value> {
        vec![json!(entry.on_date), json!(entry.title), json!(entry.year), json!(entry.status), json!(entry.rating), json!(entry.amount), json!(entry.note), json!(entry.ext_id), json!(entry.source), json!(entry.format), json!(entry.at)]
    }

    /// The line the log writes, a field per column and nothing for what is not there.
    #[must_use]
    pub fn line(entry: &Entry) -> Vec<String> {
        let moment = entry.at.and_then(|at| chrono::DateTime::from_timestamp(at, 0)).map(|at| at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
        let mut fields: Vec<String> = Self::values(entry)
            .into_iter()
            .take(HEADER.len())
            .map(|value| match value {
                Value::Null => String::new(),
                Value::String(text) => text,
                other => other.to_string(),
            })
            .collect();
        if let Some(moment) = moment {
            fields[0] = moment;
        }
        fields
    }

    /// The log's text, telling how to make the file when there is none.
    pub fn read_file(&self, path: &Path) -> Result<String> {
        log_file::read(path, self.made_by)
    }

    /// Makes the table the log's lines and nothing else.
    pub fn replace(&self, db: &SqliteClient, entries: &[Entry]) -> Result<usize> {
        self.replace_in(Ledger::Log, db, entries)
    }

    /// Makes the table of either file its lines and nothing else.
    pub fn replace_in(&self, ledger: Ledger, db: &SqliteClient, entries: &[Entry]) -> Result<usize> {
        let table = self.table(ledger.kind());
        log_file::replace(db, &table, &ENTRY_COLUMNS, entries.iter().map(Self::values).collect(), &self.file_name(ledger))?;
        if let Some(overlay) = self.overlay {
            overlay(db).with_context(|| format!("laying the winning source over {table}"))?;
        }
        Ok(entries.len())
    }

    /// Makes the table exactly the log's lines.
    pub fn import(&self, db: &SqliteClient, path: &Path) -> Result<usize> {
        let entries = self.read(&self.read_file(path)?)?;
        self.replace(db, &entries)
    }

    /// Makes the collection's table exactly the file's lines; a collection that is not written yet is an empty one.
    pub fn import_collection(&self, db: &SqliteClient, path: &Path) -> Result<usize> {
        let entries = if path.exists() { self.read_in(Ledger::Collection, &self.read_file(path)?)? } else { Vec::new() };
        self.replace_in(Ledger::Collection, db, &entries)
    }

    /// The `import-collection` job every tool has.
    pub fn import_collection_job(&self, db: &SqliteClient, path: &Path) -> Result<()> {
        println!("import-collection: {} lines", self.import_collection(db, path)?);
        Ok(())
    }

    /// The `import-log` job every tool has: import the file and report how many lines it had.
    pub fn import_log(&self, db: &SqliteClient, path: &Path) -> Result<()> {
        println!("import-log: {} lines", self.import(db, path)?);
        Ok(())
    }

    /// Adds already-checked lines to the file (the log or the collection), with the header first when the file is new.
    pub fn append(&self, path: &Path, entries: &[Entry]) -> Result<()> {
        log_file::append(path, &HEADER, self.name, entries.iter().map(Self::line))
    }

    /// The lines of `found` that the log does not have yet (by the service's number, so a line the owner has edited is
    /// never written again), appended and imported. The log stays the record: a service only adds to it.
    pub fn append_new(&self, db: &SqliteClient, path: &Path, found: &[Entry]) -> Result<usize> {
        self.append_new_in(Ledger::Log, db, path, found)
    }

    /// The same for the collection: what a service says the owner has or wants, appended to its file and imported.
    pub fn append_new_in(&self, ledger: Ledger, db: &SqliteClient, path: &Path, found: &[Entry]) -> Result<usize> {
        let known: BTreeSet<String> = if path.exists() { self.read_in(ledger, &self.read_file(path)?)?.into_iter().filter_map(|entry| entry.source).collect() } else { BTreeSet::new() };
        let mut seen = known;
        let new: Vec<Entry> = found.iter().filter(|entry| entry.source.as_ref().is_some_and(|id| seen.insert(id.clone()))).cloned().collect();
        self.append(path, &new)?;
        match ledger {
            Ledger::Log => self.import(db, path)?,
            Ledger::Collection => self.import_collection(db, path)?,
        };
        Ok(new.len())
    }

    /// Writes the service's number into the `source` of the log's lines `lines` count from the first (as `read` numbers
    /// them), keeping every comment and every other field as it is. The file as it was is kept once beside it as
    /// `<file>.before-<tag>`: this is the one place a tool edits what the owner wrote.
    pub fn set_sources(&self, path: &Path, tag: &str, sources: &[(usize, String)]) -> Result<()> {
        self.rewrite(path, tag, |line, fields| {
            if let Some((_, source)) = sources.iter().find(|(wanted, _)| *wanted == line) {
                fields.resize(fields.len().max(9), String::new());
                fields[8].clone_from(source);
            }
        })
    }

    /// Writes the register's number into the `ext_id` of every line of the log (or the collection) that names `title` and
    /// has none (a game played on many days has a line for each), which settles a title the register could not match;
    /// returns how many such lines there were. The file is kept as it was like `set_sources` does.
    pub fn settle(&self, ledger: Ledger, path: &Path, title: &str, ext_id: &str) -> Result<usize> {
        let wanted = comparable(title);
        let count = self.read_in(ledger, &self.read_file(path)?)?.iter().filter(|entry| entry.ext_id.is_none() && comparable(&entry.title) == wanted).count();
        if count > 0 {
            self.rewrite(path, "settle", |_, fields| {
                if fields.get(1).is_some_and(|name| comparable(name) == wanted) && fields.get(7).is_none_or(|id| id.trim().is_empty()) {
                    fields.resize(fields.len().max(8), String::new());
                    fields[7] = ext_id.to_string();
                }
            })?;
        }
        Ok(count)
    }

    /// Takes out the lines of the collection that name `title`, which is what the owner says is not a game or a book after all;
    /// returns how many there were. The file is kept as it was, and the log is not touched: what was played stays played.
    pub fn remove(&self, path: &Path, title: &str) -> Result<usize> {
        let wanted = comparable(title);
        let count = self.read_in(Ledger::Collection, &self.read_file(path)?)?.iter().filter(|entry| comparable(&entry.title) == wanted).count();
        if count > 0 {
            self.rewrite_where(path, "remove", |_, fields| fields.get(1).is_none_or(|name| comparable(name) != wanted))?;
        }
        Ok(count)
    }

    /// Rewrites the log with `edit` applied to each line's fields (`line` counts the lines that are neither the header nor a comment).
    fn rewrite(&self, path: &Path, tag: &str, mut edit: impl FnMut(usize, &mut Vec<String>)) -> Result<()> {
        self.rewrite_where(path, tag, |line, fields| {
            edit(line, fields);
            true
        })
    }

    /// Like `rewrite`, and a line for which `edit` says false is left out of the file.
    fn rewrite_where(&self, path: &Path, tag: &str, mut edit: impl FnMut(usize, &mut Vec<String>) -> bool) -> Result<()> {
        let text = self.read_file(path)?;
        let backup = path.with_extension(format!("csv.before-{tag}"));
        if !backup.exists() {
            std::fs::write(&backup, &text).with_context(|| format!("keeping the {} as it was in {}", self.name, backup.display()))?;
        }
        let mut reader = csv::ReaderBuilder::new().has_headers(false).flexible(true).from_reader(text.as_bytes());
        let mut writer = csv::WriterBuilder::new().flexible(true).from_writer(Vec::new());
        let (mut line, mut first) = (0, true);
        for (index, record) in reader.records().enumerate() {
            let record = record.with_context(|| format!("reading record {} of the {}", index + 1, self.name))?;
            let is_comment = record.get(0).is_some_and(|first| first.starts_with('#'));
            // As `read` has it: the header is the first record that is no comment.
            let is_header = !is_comment && std::mem::take(&mut first) && record.get(0).is_some_and(|name| name.trim() == HEADER[0]);
            let mut fields: Vec<String> = record.iter().map(str::to_string).collect();
            if !is_header && !is_comment {
                let keep = edit(line, &mut fields);
                line += 1;
                if !keep {
                    continue;
                }
            }
            writer.write_record(&fields)?;
        }
        let bytes = writer.into_inner().map_err(|error| anyhow::anyhow!("writing the {}: {error}", self.name))?;
        let temporary = path.with_extension("csv.new");
        std::fs::write(&temporary, bytes).with_context(|| format!("writing {}", temporary.display()))?;
        std::fs::rename(&temporary, path).with_context(|| format!("replacing {}", path.display()))
    }

    /// The titles the log names with no register number and no answer kept yet, each with its year (0 for none), for
    /// the register to look up.
    #[must_use]
    pub fn unresolved(&self, db: &SqliteClient) -> Vec<(String, i64)> {
        let (entry, collection, matches) = (self.table("entry"), self.table("collection"), self.table("match"));
        let named = format!("SELECT title, year, ext_id FROM {entry} UNION ALL SELECT title, year, ext_id FROM {collection}");
        let sql = format!("SELECT DISTINCT title, COALESCE(year, 0) AS year FROM ({named}) AS named WHERE ext_id IS NULL AND NOT EXISTS (SELECT 1 FROM {matches} WHERE {matches}.title = named.title AND {matches}.year = COALESCE(named.year, 0)) ORDER BY title");
        db.query(&sql, &[]).unwrap_or_default().iter().filter_map(|row: &Value| Some((row["title"].as_str()?.to_string(), row["year"].as_i64()?))).collect()
    }

    /// Keeps what a search came to: the number, or the candidates (and no number).
    pub fn save_match(&self, db: &SqliteClient, title: &str, year: i64, found: &Found, now: i64) -> Result<()> {
        let (ext_id, candidates) = match found {
            Found::Number(id) => (Some(id.clone()), None),
            Found::Candidates(hits) => (None, Some(json!(hits.iter().map(|hit| json!({"ext_id": hit.ext_id, "title": hit.title, "year": hit.year})).collect::<Vec<_>>()).to_string())),
        };
        let matches = self.table("match");
        db.execute(&format!("INSERT OR REPLACE INTO {matches} (title, year, ext_id, candidates, tried_at) VALUES (?, ?, ?, ?, ?)"), &[json!(title), json!(year), json!(ext_id), json!(candidates), json!(now)])
    }

    /// The register numbers the log or a match names, those with no answer stored yet (or all of them for a refresh).
    pub fn to_fetch(&self, db: &SqliteClient, everything: bool) -> Result<Vec<String>> {
        let (entry, collection, matches, item) = (self.table("entry"), self.table("collection"), self.table("match"), self.table("item"));
        let named = format!("SELECT ext_id FROM {entry} WHERE ext_id IS NOT NULL UNION SELECT ext_id FROM {collection} WHERE ext_id IS NOT NULL UNION SELECT ext_id FROM {matches} WHERE ext_id IS NOT NULL");
        let sql = if everything { format!("{named} ORDER BY ext_id") } else { format!("SELECT ext_id FROM ({named}) WHERE ext_id NOT IN (SELECT ext_id FROM {item}) ORDER BY ext_id") };
        Ok(db.query(&sql, &[])?.iter().filter_map(|row| row["ext_id"].as_str().map(str::to_string)).collect())
    }

    /// Stores one work and its genres, replacing what was stored for it.
    pub fn save_item(&self, db: &SqliteClient, item: &Item, now: i64) -> Result<()> {
        let (items, genres) = (self.table("item"), self.table("genre"));
        let mut batch = vec![
            (format!("INSERT OR REPLACE INTO {items} (ext_id, title, creator, year, summary, cover, banner, url, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"), vec![json!(item.ext_id), json!(item.title), json!(item.creator), json!(item.year), json!(item.summary), json!(item.cover), json!(item.banner), json!(item.url), json!(now)]),
            (format!("DELETE FROM {genres} WHERE ext_id = ?"), vec![json!(item.ext_id)]),
        ];
        batch.extend(insert_statements("INSERT OR IGNORE INTO", &genres, &["ext_id", "genre"], item.genres.iter().map(|genre| vec![json!(item.ext_id), json!(genre)])));
        db.execute_batch(&batch).with_context(|| format!("storing {}", item.title))
    }

    /// A log path under the temporary directory, for a test that writes a file nobody keeps.
    #[must_use]
    pub fn temp_path(tag: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!("shelf-{tag}-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&directory);
        directory.join("log.csv")
    }
}

/// The HTTP client every source of the three tools uses: identified, and not left waiting for a slow register.
pub fn http(user_agent: &str) -> Result<reqwest::blocking::Client> {
    crate::http::client(user_agent)
}

/// Where today's originals of `source` are landed (`.data/raw/<source>/<date>/`), made if it is not there. A run that
/// is repeated the same day lands into the same folder, and `land` writes each answer once.
pub fn landing(source: &str) -> Result<PathBuf> {
    let directory = crate::raw::landing_path(source, chrono::Utc::now().date_naive())?;
    std::fs::create_dir_all(&directory).with_context(|| format!("creating {}", directory.display()))?;
    Ok(directory)
}

/// Seconds since the epoch, for `fetched_at` and `tried_at`.
#[must_use]
pub fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

impl Shelf {
    /// Looks up each title the log names with no number: `search` asks the register, the answer is kept (the number, or
    /// the candidates for the owner to choose from) and a title is never asked twice.
    pub fn resolve(&self, db: &SqliteClient, mut search: impl FnMut(&str, i64) -> Result<Vec<Hit>>) -> Result<()> {
        let titles = self.unresolved(db);
        let (mut found, mut candidates) = (0, 0);
        for (title, year) in &titles {
            let hits = search(title, *year).with_context(|| format!("searching for {title}"))?;
            let mut answer = pick(&hits, title, *year);
            // A title with a subtitle or an edition in brackets is looked for by its main title; where a book's year is
            // the edition's, the register's year is not the same, so for books the year is not asked for last.
            if let (Found::Candidates(_), Some(main)) = (&answer, main_title(title)) {
                let hits = search(&main, *year).with_context(|| format!("searching for {main}"))?;
                answer = pick(&hits, &main, *year);
                if matches!(answer, Found::Candidates(_)) && self.prefix == "book" && *year != 0 {
                    answer = pick(&hits, &main, 0);
                }
            }
            if let (Found::Candidates(_), "book", true) = (&answer, self.prefix, *year != 0) {
                answer = pick(&hits, title, 0);
            }
            match answer {
                Found::Number(_) => found += 1,
                Found::Candidates(_) => candidates += 1,
            }
            self.save_match(db, title, *year, &answer, now())?;
        }
        println!("resolve: {} titles, {found} found, {candidates} left to choose from (write the register's number in the log's ext_id)", titles.len());
        Ok(())
    }

    /// Fetches what the register says about each number the log or a match names, and keeps it. `fetch` gives none for
    /// a number the register no longer has.
    pub fn fetch_items(&self, db: &SqliteClient, everything: bool, mut fetch: impl FnMut(&str) -> Result<Option<Item>>) -> Result<()> {
        let ids = self.to_fetch(db, everything)?;
        let mut kept = 0;
        for id in &ids {
            match fetch(id).with_context(|| format!("fetching {id}"))? {
                Some(item) => {
                    self.save_item(db, &item, now())?;
                    kept += 1;
                }
                None => println!("fetch: the register has no {id}"),
            }
        }
        println!("fetch: {kept} of {} kept", ids.len());
        Ok(())
    }
}

/// What the three tools' `main` differ in; the rest of it, the jobs every one of them has (`import-log`, `add`) and
/// opening the database, is `run`.
pub struct Tool {
    pub program: &'static str,
    pub shelf: Shelf,
    /// The variable that moves the log, and where it is by default (relative to `apps/<app>/`).
    pub log: (&'static str, &'static str),
    /// The same for the collection file.
    pub collection: (&'static str, &'static str),
    /// The variable that moves the database, where it is by default and its name in `db/migrations/`.
    pub database: (&'static str, &'static str, &'static str),
    pub schema: &'static str,
}

/// What a job of a shelf tool is given: the database, the paths of the log and the collection, and the shelf.
pub struct Session {
    pub db: SqliteClient,
    pub shelf: Shelf,
    pub log: PathBuf,
    pub collection: PathBuf,
}

/// `-` leaves a field of `add` empty.
fn argument(text: &str) -> String {
    blank(text).filter(|text| *text != "-").unwrap_or_default().to_string()
}

fn settle(context: &Session, args: &Args) -> Result<()> {
    let ext_id = args.positional(1).trim();
    if ext_id.is_empty() {
        bail!("settle needs the register's number after the title");
    }
    let title = args.positional(0);
    for (ledger, path) in [(Ledger::Log, &context.log), (Ledger::Collection, &context.collection)] {
        match context.shelf.settle(ledger, path, title, ext_id)? {
            0 => {}
            count => {
                context.shelf.import_log(&context.db, &context.log)?;
                context.shelf.import_collection_job(&context.db, &context.collection)?;
                println!("settled {title} as {ext_id} on {count} lines of {}", path.display());
                return Ok(());
            }
        }
    }
    bail!("no line of the log or the collection names «{title}» and has no ext_id")
}

fn remove(context: &Session, args: &Args) -> Result<()> {
    let title = args.positional(0);
    match context.shelf.remove(&context.collection, title)? {
        0 => bail!("no line of the collection names «{title}»"),
        count => {
            context.shelf.import_collection_job(&context.db, &context.collection)?;
            println!("removed {count} lines of «{title}» from {}", context.collection.display());
            Ok(())
        }
    }
}

fn add(context: &Session, args: &Args) -> Result<()> {
    // Built as a line and read back, so what `add` accepts is what `import-log` accepts.
    let mut line = vec![String::new(); HEADER.len()];
    line[0] = argument(args.positional(2));
    line[1] = args.positional(0).to_string();
    line[2] = argument(args.positional(1));
    line[3] = context.shelf.added_as.to_string();
    line[4] = argument(args.positional(3));
    let entry = context.shelf.parse_line(&line).context("the line to add")?;
    context.shelf.append(&context.log, std::slice::from_ref(&entry))?;
    println!("added {}; {} lines in all", entry.title, context.shelf.import(&context.db, &context.log)?);
    Ok(())
}

impl Tool {
    /// Runs the job named on the command line: the two every tool has, and the tool's own `extra` ones.
    pub fn run(&self, extra: Vec<Job<Session>>) -> Result<()> {
        let mut jobs = vec![
            Job::new("import-log", "make the table exactly the log's lines", |context: &Session, _| context.shelf.import_log(&context.db, &context.log)),
            Job::new("import-collection", "make the collection's table exactly the collection file's lines", |context: &Session, _| context.shelf.import_collection_job(&context.db, &context.collection)),
            Job::new("settle", "write the register's number into the log's line of a title the register could not match, then import", settle).takes(&["title", "ext_id"]),
            Job::new("remove", "take a title out of the collection (the log is left as it is), then import", remove).takes(&["title"]),
            Job::new("add", "add a line to the log («-» for no year, day or rating) and import it", add).takes(&["title", "year", "date", "rating"]),
        ];
        jobs.extend(extra);
        let open = || {
            let (variable, default, name) = self.database;
            let (log_variable, log_default) = self.log;
            let (collection_variable, collection_default) = self.collection;
            Ok(Session {
                db: open_migrated(&path_from_env(variable, default), self.schema, name).with_context(|| format!("opening the {name} database"))?,
                shelf: self.shelf,
                log: path_from_env(log_variable, log_default),
                collection: path_from_env(collection_variable, collection_default),
            })
        };
        run_from_argv(self.program, "", &jobs, open)
    }
}

/// An address on the register's own image host, or none: a cover is shown in a page, so nothing but http(s) goes in.
#[must_use]
pub fn web_address(text: &str) -> Option<String> {
    let text = text.trim();
    (text.starts_with("https://") || text.starts_with("http://")).then(|| text.to_string())
}

/// The year of a text that starts with one (`2019-03-12`, `March 2019`, `1999`), or none.
#[must_use]
pub fn year_in(text: &str) -> Option<i64> {
    let digits: Vec<char> = text.chars().collect();
    digits.windows(4).find(|window| window.iter().all(char::is_ascii_digit)).and_then(|window| window.iter().collect::<String>().parse().ok()).filter(|year| (1000..=2999).contains(year))
}

#[cfg(test)]
mod tests {
    use super::*;

    const GAMES: Shelf = Shelf { prefix: "game", name: "games log", statuses: &["playing", "done", "dropped"], added_as: "done", overlay: None, made_by: "games-sync steam" };
    const SCHEMA: &str = include_str!("../../../db/games.sql");
    const LOG: &str = "# my games\ndate,title,year,status,rating,amount,note,ext_id,source\n2026-10-01,\"Hades\",2020,done,4.5,32,\"Fast, and good\",1,\n,Celeste,2018,,5,,,,\n2026-10-03,Tunic,,playing,,,,,steam:553420\n";

    fn db() -> SqliteClient {
        crate::app_db::memory_with_schema(SCHEMA)
    }

    fn hit(id: &str, title: &str, year: Option<i64>, popularity: f64) -> Hit {
        Hit { ext_id: id.into(), title: title.into(), year, popularity }
    }

    #[test]
    fn a_moment_in_the_date_field_keeps_its_day_and_comes_back_as_the_same_line() {
        let entries = GAMES.read("date,title\n2026-10-28T11:29:00Z,Tunic\n2026-10-28,Hades\n").unwrap_or_else(|error| panic!("{error}"));
        assert_eq!((entries[0].on_date.as_deref(), entries[0].at), (Some("2026-10-28"), Some(1_793_186_940)));
        assert_eq!((entries[1].on_date.as_deref(), entries[1].at), (Some("2026-10-28"), None));
        assert_eq!(Shelf::line(&entries[0])[0], "2026-10-28T11:29:00Z");
        assert_eq!(Shelf::line(&entries[1])[0], "2026-10-28");
        assert!(GAMES.read("date,title\n2026-10-28 11:29,Tunic\n").is_err());
    }

    #[test]
    fn the_real_schema_is_only_idempotent_statements() {
        assert!(crate::app_db::unsafe_to_repeat(SCHEMA).is_empty());
    }

    #[test]
    fn a_line_is_read_and_an_empty_status_is_the_first() {
        let entries = GAMES.read(LOG).unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!(entries.len(), 3);
        assert_eq!((entries[0].title.as_str(), entries[0].year, entries[0].rating, entries[0].amount, entries[0].note.as_deref()), ("Hades", Some(2020), Some(4.5), Some(32.0), Some("Fast, and good")));
        assert_eq!((entries[1].on_date.as_deref(), entries[1].status.as_str()), (None, "playing"));
        assert_eq!(entries[2].source.as_deref(), Some("steam:553420"));
    }

    #[test]
    fn a_format_is_the_tenth_field_lowercase_and_a_log_without_it_still_reads() {
        let entries = GAMES.read("date,title,year,status,rating,amount,note,ext_id,source,format\n,Tunic,2022,playing,,,,,,Switch\n,Celeste,2018,playing,,,,,\n").unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!((entries[0].format.as_deref(), entries[1].format.as_deref()), (Some("switch"), None));
    }

    #[test]
    fn a_line_written_back_is_the_line_it_was_read_from() {
        let entries = GAMES.read("date,title,year,status,rating,amount,note,ext_id,source\n2026-10-01,\"Hades\",2020,done,4.5,32,\"a, b\",1,steam:1\n").unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!(Shelf::line(&entries[0]), vec!["2026-10-01", "Hades", "2020", "done", "4.5", "32.0", "a, b", "1", "steam:1", ""]);
        let path = Shelf::temp_path("roundtrip");
        let _ = std::fs::remove_file(&path);
        GAMES.append(&path, &entries).unwrap_or_else(|error| panic!("{error:#}"));
        let again = GAMES.read(&GAMES.read_file(&path).unwrap_or_default()).unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!(again, entries);
    }

    #[test]
    fn a_wrong_line_is_refused_with_its_line_number_and_what_is_wrong() {
        for (line, wrong) in [("2026-13-01,A,2000,done,,,,,", "not a date"), ("2026-01-01,,2000,done,,,,,", "title is empty"), ("2026-01-01,A,abc,done,,,,,", "not a year"), ("2026-01-01,A,2000,done,6,,,,", "half steps"), ("2026-01-01,A,2000,done,3.3,,,,", "half steps"), ("2026-01-01,A,2000,maybe,,,,,", "not a status"), ("2026-01-01,A,2000,done,,-3,,,", "zero or more")] {
            let error = format!("{:#}", GAMES.read(&format!("{}\n{line}\n", HEADER.join(","))).err().unwrap_or_else(|| panic!("{line} was accepted")));
            assert!(error.contains("line 2") && error.contains(wrong), "{line}: {error}");
        }
    }

    #[test]
    fn importing_twice_leaves_the_log_and_a_line_removed_from_it_is_removed_here() {
        let db = db();
        let path = Shelf::temp_path("import");
        std::fs::write(&path, LOG).unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(GAMES.import(&db, &path).unwrap_or_else(|error| panic!("{error:#}")), 3);
        assert_eq!(GAMES.import(&db, &path).unwrap_or_else(|error| panic!("{error:#}")), 3);
        std::fs::write(&path, ",Inside,2016,done,,,,,\n").unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(GAMES.import(&db, &path).unwrap_or_else(|error| panic!("{error:#}")), 1);
        let rows = db.query("SELECT title, on_date FROM game_entry", &[]).unwrap_or_default();
        assert_eq!((rows.len(), rows[0]["title"].clone(), rows[0]["on_date"].clone()), (1, json!("Inside"), Value::Null));
    }

    #[test]
    fn a_service_only_adds_what_the_log_does_not_have_by_number() {
        let db = db();
        let path = Shelf::temp_path("append");
        let _ = std::fs::remove_file(&path);
        let owned = |id: &str, title: &str| Entry { title: title.into(), status: "playing".into(), source: Some(id.into()), ..Entry::default() };
        assert_eq!(GAMES.append_new(&db, &path, &[owned("steam:1", "Hades"), owned("steam:1", "Hades"), owned("steam:2", "Celeste")]).unwrap_or(0), 2);
        // The owner edits a line; the next pull does not bring it back as it was.
        let text = std::fs::read_to_string(&path).unwrap_or_default().replace("Hades", "Hades II");
        std::fs::write(&path, text).unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(GAMES.append_new(&db, &path, &[owned("steam:1", "Hades"), owned("steam:3", "Tunic")]).unwrap_or(0), 1);
        let titles: Vec<String> = db.query("SELECT title FROM game_entry ORDER BY id", &[]).unwrap_or_default().iter().filter_map(|row| row["title"].as_str().map(str::to_string)).collect();
        assert_eq!(titles, ["Hades II", "Celeste", "Tunic"]);
        assert_eq!(text_header_count(&path), 1);
    }

    #[test]
    fn the_collection_is_its_own_file_and_table_and_the_log_refuses_its_words() {
        let db = db();
        let path = Shelf::temp_path("collection");
        std::fs::write(&path, "date,title,year,status,rating,amount,note,ext_id,source,format\n,Tunic,2022,,,,,,steam:1,steam\n,Hades II,2024,want,,,,,,\n").unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(GAMES.import_collection(&db, &path).unwrap_or_else(|error| panic!("{error:#}")), 2);
        assert_eq!(GAMES.import_collection(&db, &path).unwrap_or_else(|error| panic!("{error:#}")), 2);
        let rows = db.query("SELECT title, status FROM game_collection ORDER BY id", &[]).unwrap_or_default();
        assert_eq!((rows[0]["status"].clone(), rows[1]["status"].clone()), (json!("owned"), json!("want")));
        assert_eq!(db.query("SELECT count(*) AS n FROM game_entry", &[]).unwrap_or_default()[0]["n"], json!(0));
        assert!(GAMES.read("date,title,year,status\n,Tunic,2022,owned\n").is_err(), "a log line cannot be owned");
        assert!(GAMES.read_in(Ledger::Collection, "date,title,year,status\n,Tunic,2022,playing\n").is_err(), "a collection line cannot be played");
        assert_eq!(GAMES.unresolved(&db), vec![("Hades II".to_string(), 2024), ("Tunic".to_string(), 2022)]);
        let missing = Shelf::temp_path("no-collection").with_file_name("none.csv");
        assert_eq!(GAMES.import_collection(&db, &missing).unwrap_or(9), 0);
    }

    fn text_header_count(path: &Path) -> usize {
        std::fs::read_to_string(path).unwrap_or_default().matches("date,title").count()
    }

    #[test]
    fn a_title_finds_its_number_or_leaves_candidates_and_is_not_asked_again() {
        let hits = [hit("a", "Hades", Some(2020), 1.0), hit("b", "Hades", Some(2020), 9.0), hit("c", "Hades II", Some(2024), 5.0)];
        assert_eq!(pick(&hits, "hades", 2020), Found::Number("b".into()));
        assert_eq!(pick(&hits, "Hades", 0), Found::Number("b".into()));
        let Found::Candidates(candidates) = pick(&hits, "Hades", 1999) else { panic!("a wrong year was accepted") };
        assert_eq!(candidates.len(), 3);

        let db = db();
        let path = Shelf::temp_path("match");
        std::fs::write(&path, LOG).unwrap_or_else(|error| panic!("{error}"));
        GAMES.import(&db, &path).unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!(GAMES.unresolved(&db), vec![("Celeste".to_string(), 2018), ("Tunic".to_string(), 0)]);
        GAMES.save_match(&db, "Celeste", 2018, &Found::Number("77".into()), 1).unwrap_or_else(|error| panic!("{error:#}"));
        GAMES.save_match(&db, "Tunic", 0, &Found::Candidates(candidates), 1).unwrap_or_else(|error| panic!("{error:#}"));
        assert!(GAMES.unresolved(&db).is_empty());
        assert_eq!(GAMES.to_fetch(&db, false).unwrap_or_default(), ["1", "77"]);
    }

    #[test]
    fn an_item_is_stored_once_with_its_genres_and_a_refresh_replaces_them() {
        let db = db();
        let item = Item { ext_id: "1".into(), title: "Hades".into(), genres: vec!["Roguelike".into(), "Action".into()], ..Item::default() };
        GAMES.save_item(&db, &item, 1).unwrap_or_else(|error| panic!("{error:#}"));
        GAMES.save_item(&db, &Item { genres: vec!["Action".into()], ..item }, 2).unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!(db.query("SELECT count(*) AS n FROM game_item", &[]).unwrap_or_default()[0]["n"], json!(1));
        assert_eq!(db.query("SELECT genre FROM game_genre", &[]).unwrap_or_default().len(), 1);
        assert!(GAMES.to_fetch(&db, false).unwrap_or_default().is_empty());
    }

    #[test]
    fn roman_numerals_and_a_few_years_off_are_the_same_work() {
        let hit = |ext_id: &str, title: &str, year| Hit { ext_id: ext_id.into(), title: title.into(), year: Some(year), popularity: 1.0 };
        let hits = [hit("1", "Baldur's Gate III", 2023), hit("2", "Fortnite", 2020), hit("3", "Prey", 2006)];
        assert_eq!(pick(&hits, "Baldur's Gate 3", 2023), Found::Number("1".into()));
        assert_eq!(pick(&hits, "Fortnite", 2017), Found::Number("2".into()));
        assert!(matches!(pick(&hits, "Prey", 2017), Found::Candidates(_)));
    }

    #[test]
    fn a_subtitle_or_an_edition_in_brackets_is_cut_off_for_a_second_look() {
        assert_eq!(main_title("Black Skin, White Masks (Penguin Modern Classics)").as_deref(), Some("Black Skin, White Masks"));
        assert_eq!(main_title("Manufacturing Consent: The Political Economy").as_deref(), Some("Manufacturing Consent"));
        assert_eq!((main_title("Piranesi"), main_title("(Untitled)")), (None, None));
    }

    #[test]
    fn a_year_is_found_in_a_date_and_an_address_must_be_web() {
        assert_eq!((year_in("2019-03-12"), year_in("March 2019"), year_in("n/a")), (Some(2019), Some(2019), None));
        assert_eq!(web_address("javascript:alert(1)"), None);
        assert_eq!(web_address(" https://x.test/a.jpg "), Some("https://x.test/a.jpg".into()));
    }
    #[test]
    fn a_title_is_settled_on_every_line_that_has_no_number() {
        let path = Shelf::temp_path("settle");
        let before = "date,title,year,status,rating,amount,note,ext_id,source\n,Cleanness,,done,,,,,\n,Heat,1995,done,,,,OL1W,\n2026-01-02,Cleanness,,done,,,,,\n";
        std::fs::write(&path, before).unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(GAMES.settle(Ledger::Log, &path, "cleanness", "OL20697002W").unwrap_or_default(), 2);
        assert_eq!(std::fs::read_to_string(&path).unwrap_or_default(), before.replace("Cleanness,,done,,,,,\n", "Cleanness,,done,,,,OL20697002W,\n"));
        // Settled already, or never in the log: nothing to change, and the file stays as it is.
        for title in ["Cleanness", "Heat", "Nothing"] {
            assert_eq!(GAMES.settle(Ledger::Log, &path, title, "OL2W").unwrap_or(9), 0, "{title}");
        }
        assert!(std::fs::read_to_string(&path).unwrap_or_default().contains("OL20697002W"));
    }

    #[test]
    fn a_title_is_taken_out_of_the_collection_with_a_copy_kept_and_nothing_else_changes() {
        let path = Shelf::temp_path("remove");
        let before = "# mine\ndate,title,year,status,rating,amount,note,ext_id,source\n2024-09-23,Cider,,owned,,,,,mail:itch:cider\n,\"Hades, the game\",2020,owned,,,,1,\n";
        std::fs::write(&path, before).unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(GAMES.remove(&path, "cider").unwrap_or(9), 1);
        assert_eq!(std::fs::read_to_string(&path).unwrap_or_default(), "# mine\ndate,title,year,status,rating,amount,note,ext_id,source\n,\"Hades, the game\",2020,owned,,,,1,\n");
        assert_eq!(std::fs::read_to_string(path.with_extension("csv.before-remove")).unwrap_or_default(), before);
        assert_eq!(GAMES.remove(&path, "Cider").unwrap_or(9), 0, "gone already");
    }

    #[test]
    fn a_source_is_written_into_a_line_and_nothing_else_in_the_file_changes() {
        let path = Shelf::temp_path("sources");
        let before = "# my games, with a comma\ndate,title,year,status,rating,amount,note,ext_id,source\n2026-10-01,\"Hades, the game\",2020,done,4.5,32,\"a, b\",1,\n,Celeste,2018,playing,,,,,\n";
        std::fs::write(&path, before).unwrap_or_else(|error| panic!("{error}"));
        GAMES.set_sources(&path, "test", &[(1, "steam:5".to_string())]).unwrap_or_else(|error| panic!("{error:#}"));
        let after = std::fs::read_to_string(&path).unwrap_or_default();
        assert_eq!(after, before.replace("playing,,,,,\n", "playing,,,,,steam:5\n"));
        let entries = GAMES.read(&after).unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!((entries[0].source.as_deref(), entries[1].source.as_deref(), entries[0].title.as_str()), (None, Some("steam:5"), "Hades, the game"));
        // The file as it was is kept once, and a second edit does not replace that copy.
        GAMES.set_sources(&path, "test", &[(0, "steam:6".to_string())]).unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!(std::fs::read_to_string(path.with_extension("csv.before-test")).unwrap_or_default(), before);
    }
}
