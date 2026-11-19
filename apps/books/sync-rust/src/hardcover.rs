//! Hardcover, where the owner shelves and rates books, in both directions. `books-sync hardcover` makes `hardcover_book`
//! and `hardcover_read` exactly what the API returns (the originals are landed under `.data/raw/hardcover/<date>/`), and
//! **Hardcover wins**: `book_entry` takes the status, rating, day and pages of every book Hardcover has from those tables
//! (`overlay`), whatever the log says; the log keeps only the lines Hardcover does not have. The commands that write
//! (`rate`, `status`, `read`, `shelve`, `push-hardcover`) send a change to Hardcover first and then pull again, so the
//! database shows what Hardcover now says; each has `--dry-run`, which prints what it would send and sends nothing.
//! The token is `HARDCOVER_TOKEN`, from hardcover.app/account/api, with or without its «Bearer ».

use std::collections::BTreeSet;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use shared_data::batch::insert_statements;
use shared_data::job::Args;
use shared_data::shelf::{http, landing, now, pick, Entry, Found, Hit, Ledger, Session, Shelf, ENTRY_COLUMNS};
use shared_data::sqlite_client::SqliteClient;
use shared_data::text::normalize;
use shared_data::tmdb::land;
use shared_data::watch_log::blank;

const ENDPOINT: &str = "https://api.hardcover.app/v1/graphql";
/// Hardcover allows sixty calls a minute.
const PAUSE: Duration = Duration::from_millis(1100);
const PAGE: usize = 500;
/// Tries per call; the waits between them (`retry_wait`) add up to about five minutes.
const ATTEMPTS: u64 = 6;

/// Worth another try: Hardcover asks to wait (429) or has a server problem (5xx).
fn is_transient(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
}

/// The pause after failed attempt number `attempt` (1-based): 10, 20, 40, 80, 160 seconds.
fn retry_wait(attempt: u64) -> Duration {
    Duration::from_secs(10 * (1 << (attempt - 1).min(4)))
}

const SHELVES_QUERY: &str = "query Shelves($limit: Int!, $offset: Int!) { me { user_books(limit: $limit, offset: $offset, order_by: [{ id: asc }]) { id status_id rating date_added book { id title release_year pages } user_book_reads(order_by: [{ id: asc }]) { id started_at finished_at progress_pages } } } }";
const SEARCH_QUERY: &str = "query Search($query: String!) { search(query: $query, query_type: \"Book\", per_page: 5, page: 1) { error ids } }";
const BOOKS_QUERY: &str = "query Books($ids: [Int!]!) { books(where: { id: { _in: $ids } }, limit: 5) { id title release_year } }";
const FIND_SHELVED_QUERY: &str = "query FindShelved($bookId: Int!) { me { user_books(where: { book_id: { _eq: $bookId } }, limit: 1) { id } } }";
const READS_QUERY: &str = "query Reads($userBookId: Int!) { user_book_reads(where: { user_book_id: { _eq: $userBookId } }, order_by: [{ id: desc }], limit: 1) { id } }";
const INSERT_SHELVED: &str = "mutation InsertUserBook($object: UserBookCreateInput!) { insert_user_book(object: $object) { user_book { id } error } }";
const UPDATE_SHELVED: &str = "mutation UpdateUserBook($id: Int!, $object: UserBookUpdateInput!) { update_user_book(id: $id, object: $object) { user_book { id } error } }";
const INSERT_READ: &str = "mutation InsertUserBookRead($userBookId: Int!, $object: DatesReadInput!) { insert_user_book_read(user_book_id: $userBookId, user_book_read: $object) { user_book_read { id } error } }";
const UPDATE_READ: &str = "mutation UpdateUserBookRead($id: Int!, $object: DatesReadInput!) { update_user_book_read(id: $id, object: $object) { user_book_read { id } error } }";

/// Hardcover's shelf number for a status of the log: 1 want to read, 2 reading, 3 read, 5 did not finish.
fn shelf_of(status: &str) -> Result<i64> {
    match status {
        "want" => Ok(1),
        "reading" => Ok(2),
        "done" => Ok(3),
        "dropped" => Ok(5),
        other => bail!("«{other}» is not a status of the books log: use want, reading, done or dropped"),
    }
}

/// The log's status for a Hardcover shelf; 4 (paused) is reading, and 6 (ignored) is not a book the owner has anything to do with.
fn status_of(shelf: i64) -> Option<&'static str> {
    match shelf {
        1 => Some("want"),
        2 | 4 => Some("reading"),
        3 => Some("done"),
        5 => Some("dropped"),
        _ => None,
    }
}

/// Hardcover rates in quarters from 0 to 5; the log has half steps from 0.5, and none for an unrated book.
fn rating_of(value: &Value) -> Option<f64> {
    let half = (value.as_f64()? * 2.0).round() / 2.0;
    (half >= 0.5).then_some(half.min(5.0))
}

fn day_of(value: &Value) -> Option<String> {
    value.as_str().and_then(|text| text.get(..10)).map(str::to_string)
}

/// The two tables' rows out of the shelves the API returned: a book per shelved book and a read per read of it.
fn rows_of(user_books: &[Value], fetched_at: i64) -> (Vec<Vec<Value>>, Vec<Vec<Value>>) {
    let mut books = Vec::new();
    let mut reads = Vec::new();
    for shelved in user_books {
        let (Some(user_book), Some(shelf), Some(book), Some(title)) = (shelved["id"].as_i64(), shelved["status_id"].as_i64(), shelved["book"]["id"].as_i64(), shelved["book"]["title"].as_str()) else { continue };
        books.push(vec![json!(user_book), json!(book), json!(title.trim()), json!(shelved["book"]["release_year"].as_i64()), json!(shelved["book"]["pages"].as_i64()), json!(shelf), json!(shelved["rating"].as_f64()), json!(day_of(&shelved["date_added"])), json!(fetched_at)]);
        for read in shelved["user_book_reads"].as_array().into_iter().flatten() {
            if let Some(id) = read["id"].as_i64() {
                reads.push(vec![json!(id), json!(user_book), json!(day_of(&read["started_at"])), json!(day_of(&read["finished_at"])), json!(read["progress_pages"].as_i64())]);
            }
        }
    }
    (books, reads)
}

/// Makes the two tables exactly what Hardcover returned.
fn store(db: &SqliteClient, user_books: &[Value]) -> Result<()> {
    let (books, reads) = rows_of(user_books, now());
    let mut batch = vec![("DELETE FROM hardcover_read".to_string(), Vec::new()), ("DELETE FROM hardcover_book".to_string(), Vec::new())];
    batch.extend(insert_statements("INSERT INTO", "hardcover_book", &["user_book_id", "book_id", "title", "release_year", "pages", "status_id", "rating", "date_added", "fetched_at"], books));
    batch.extend(insert_statements("INSERT INTO", "hardcover_read", &["read_id", "user_book_id", "started_at", "finished_at", "progress_pages"], reads));
    db.execute_batch(&batch).context("storing what Hardcover returned")
}

/// A shelved book as the log would say it, from its row and the latest of its reads (the day a book was finished is its
/// last read's, and a book not finished has the day it was started, or else the day it was shelved).
fn entry_of(book: &Value, read: Option<&Value>) -> Option<Entry> {
    let status = status_of(book["status_id"].as_i64()?)?;
    let started = read.and_then(|read| day_of(&read["started_at"]));
    let finished = read.and_then(|read| day_of(&read["finished_at"]));
    let on_date = match status {
        "done" | "dropped" => finished.or_else(|| day_of(&book["date_added"])),
        "reading" => started.or_else(|| day_of(&book["date_added"])),
        _ => None,
    };
    let amount = if status == "done" { book["pages"].as_f64() } else { read.and_then(|read| read["progress_pages"].as_f64()) }.filter(|pages| *pages > 0.0);
    Some(Entry { on_date, title: book["title"].as_str()?.to_string(), year: book["release_year"].as_i64(), status: status.to_string(), rating: rating_of(&book["rating"]), amount, source: Some(format!("hardcover:{}", book["book_id"].as_i64()?)), ..Entry::default() })
}

/// Lays Hardcover over `book_entry` and `book_collection`: a line the log has for a Hardcover book takes Hardcover's status,
/// rating, day and pages, and a book the log lacks is added; a book on the want-to-read shelf is a line of the collection
/// instead, and leaves it again when it is started. Called after every import (`Shelf::overlay`), so it holds whichever job ran.
pub fn overlay(db: &SqliteClient) -> Result<()> {
    let books = db.query("SELECT user_book_id, book_id, title, release_year, pages, status_id, rating, date_added FROM hardcover_book ORDER BY user_book_id", &[])?;
    let reads = db.query("SELECT user_book_id, started_at, finished_at, progress_pages FROM hardcover_read ORDER BY read_id", &[])?;
    let sources_of = |table: &str| -> Result<BTreeSet<String>> { Ok(db.query(&format!("SELECT source FROM {table} WHERE source IS NOT NULL"), &[])?.iter().filter_map(|row| row["source"].as_str().map(str::to_string)).collect()) };
    let (known, wanted) = (sources_of("book_entry")?, sources_of("book_collection")?);
    let mut batch = Vec::new();
    let (mut added, mut added_wanted) = (Vec::new(), Vec::new());
    for book in &books {
        let latest = reads.iter().rfind(|read| read["user_book_id"] == book["user_book_id"]);
        let Some(entry) = entry_of(book, latest) else { continue };
        let source = entry.source.clone().unwrap_or_default();
        if entry.status == "want" {
            if wanted.contains(&source) {
                batch.push(("UPDATE book_collection SET rating = ? WHERE source = ?".to_string(), vec![json!(entry.rating), json!(source)]));
            } else {
                added_wanted.push(Shelf::values(&entry));
            }
            continue;
        }
        if wanted.contains(&source) {
            batch.push(("DELETE FROM book_collection WHERE source = ? AND status = 'want'".to_string(), vec![json!(source)]));
        }
        if known.contains(&source) {
            batch.push(("UPDATE book_entry SET status = ?, rating = ?, on_date = ?, amount = ? WHERE source = ?".to_string(), vec![json!(entry.status), json!(entry.rating), json!(entry.on_date), json!(entry.amount), json!(source)]));
        } else {
            added.push(Shelf::values(&entry));
        }
    }
    batch.extend(insert_statements("INSERT INTO", "book_entry", &ENTRY_COLUMNS, added));
    batch.extend(insert_statements("INSERT INTO", "book_collection", &ENTRY_COLUMNS, added_wanted));
    db.execute_batch(&batch).context("laying Hardcover over the books")
}

struct Client {
    http: reqwest::blocking::Client,
    token: String,
}

impl Client {
    fn from_env() -> Result<Self> {
        let token = std::env::var("HARDCOVER_TOKEN").context("HARDCOVER_TOKEN is not set: make a token at hardcover.app/account/api and put it in the environment of the job")?;
        Ok(Self { http: http("books-sync (lmfaole.party; hei@lmfaole.party)")?, token: token.trim().trim_start_matches("Bearer ").to_string() })
    }

    /// One call: retried after a pause when Hardcover says to wait, is down (5xx) or cannot be reached yet (DNS or network not up, as right after a boot), and an error in the answer is an error here.
    fn call(&self, query: &str, variables: &Value) -> Result<Value> {
        for attempt in 1..=ATTEMPTS {
            let last = attempt == ATTEMPTS;
            let answer = match self.http.post(ENDPOINT).bearer_auth(&self.token).json(&json!({ "query": query, "variables": variables })).send() {
                Ok(answer) => answer,
                Err(error) if error.is_connect() && !last => {
                    std::thread::sleep(retry_wait(attempt));
                    continue;
                }
                Err(error) => return Err(error).context("asking Hardcover"),
            };
            std::thread::sleep(PAUSE);
            if is_transient(answer.status()) && !last {
                std::thread::sleep(retry_wait(attempt));
                continue;
            }
            let answer: Value = answer.error_for_status().context("Hardcover answered with an error")?.json().context("reading Hardcover's answer")?;
            if let Some(errors) = answer["errors"].as_array().filter(|errors| !errors.is_empty()) {
                bail!("Hardcover answered with errors: {}", Value::Array(errors.clone()));
            }
            return Ok(answer["data"].clone());
        }
        bail!("Hardcover is rate limiting or down: try again in a few minutes")
    }

    /// The `error` Hardcover puts in the answer of a mutation, as an error.
    fn mutate(&self, name: &str, query: &str, variables: &Value) -> Result<Value> {
        let data = self.call(query, variables)?;
        if let Some(error) = data[name]["error"].as_str().filter(|error| !error.is_empty()) {
            bail!("Hardcover refused {name}: {error}");
        }
        Ok(data[name].clone())
    }
}

/// Every shelved book Hardcover returns, a page at a time.
fn all_shelved(client: &Client) -> Result<Vec<Value>> {
    let mut all = Vec::new();
    loop {
        let data = client.call(SHELVES_QUERY, &json!({ "limit": PAGE, "offset": all.len() }))?;
        let me = if data["me"].is_array() { &data["me"][0] } else { &data["me"] };
        let page = me["user_books"].as_array().cloned().unwrap_or_default();
        let count = page.len();
        all.extend(page);
        if count < PAGE {
            return Ok(all);
        }
    }
}

/// Pulls Hardcover: lands what it returned, makes the two tables exactly that and lays it over the entries.
pub fn pull(session: &Session) -> Result<()> {
    let client = Client::from_env()?;
    refresh(session, &client)
}

fn refresh(session: &Session, client: &Client) -> Result<()> {
    let shelved = all_shelved(client)?;
    land(&landing("hardcover")?.join("user_books.json"), &Value::Array(shelved.clone()))?;
    store(&session.db, &shelved)?;
    // A log that does not exist yet is an empty one: Hardcover alone can fill the table.
    let entries = if session.log.exists() { session.shelf.read(&session.shelf.read_file(&session.log)?)? } else { Vec::new() };
    let owned = if session.collection.exists() { session.shelf.read_in(Ledger::Collection, &session.shelf.read_file(&session.collection)?)? } else { Vec::new() };
    session.shelf.replace_in(Ledger::Collection, &session.db, &owned)?;
    session.shelf.replace(&session.db, &entries)?;
    println!("hardcover: {} books on the shelves", shelved.len());
    Ok(())
}

/// The shelved book a title names: the title spelled the same, else the only one that contains it.
fn shelved_named(db: &SqliteClient, title: &str) -> Result<(i64, i64, String)> {
    let rows = db.query("SELECT user_book_id, book_id, title FROM hardcover_book ORDER BY title", &[])?;
    let wanted = normalize(title);
    let found = |matches: &dyn Fn(&str) -> bool| -> Vec<(i64, i64, String)> { rows.iter().filter_map(|row| Some((row["user_book_id"].as_i64()?, row["book_id"].as_i64()?, row["title"].as_str()?.to_string()))).filter(|(_, _, name)| matches(&normalize(name))).collect() };
    let mut candidates = found(&|name| name == wanted);
    if candidates.is_empty() {
        candidates = found(&|name| name.contains(&wanted));
    }
    match candidates.len() {
        1 => Ok(candidates.remove(0)),
        0 => bail!("none of the books on your Hardcover shelves is called «{title}»: pull first (`books-sync hardcover`), or shelve it (`books-sync shelve`)"),
        _ => bail!("«{title}» names more than one book: {}", candidates.iter().map(|(_, _, name)| format!("«{name}»")).collect::<Vec<_>>().join(", ")),
    }
}

/// What Hardcover is told: printed instead of sent under `--dry-run`.
fn send(client: Option<&Client>, name: &str, query: &str, variables: &Value) -> Result<Value> {
    if let Some(client) = client {
        return client.mutate(name, query, variables);
    }
    println!("would send {name} {variables}");
    Ok(Value::Null)
}

/// The update of a shelved book: only the fields given, as Hardcover patches what is sent.
fn shelved_patch(status: Option<&str>, rating: Option<f64>) -> Result<Value> {
    let mut object = serde_json::Map::new();
    if let Some(status) = status {
        object.insert("status_id".to_string(), json!(shelf_of(status)?));
    }
    if let Some(rating) = rating {
        object.insert("rating".to_string(), json!(rating));
    }
    Ok(Value::Object(object))
}

/// The dates of a read: only the fields given, as Hardcover patches what is sent.
fn read_patch(started: Option<&str>, finished: Option<&str>, pages: Option<i64>) -> Value {
    let mut object = serde_json::Map::new();
    for (key, value) in [("started_at", started), ("finished_at", finished)] {
        if let Some(day) = value {
            object.insert(key.to_string(), json!(day));
        }
    }
    if let Some(pages) = pages {
        object.insert("progress_pages".to_string(), json!(pages));
    }
    Value::Object(object)
}

/// A day written `YYYY-MM-DD`, or none for `-`.
fn day_argument(text: &str) -> Result<Option<String>> {
    let Some(day) = blank(text).filter(|text| *text != "-") else { return Ok(None) };
    chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d").with_context(|| format!("«{day}» is not a date written YYYY-MM-DD"))?;
    Ok(Some(day.to_string()))
}

/// The client of a write: none under `--dry-run`, which needs no token.
fn writer(args: &Args) -> Result<Option<Client>> {
    if args.flag("--dry-run") { Ok(None) } else { Client::from_env().map(Some) }
}

/// Sets the dates of the latest read of a shelved book (or makes the first), so a book finished on a day has that day and not the day it was shelved.
fn set_read(client: Option<&Client>, user_book: i64, known: Option<i64>, patch: &Value) -> Result<()> {
    if patch.as_object().is_some_and(serde_json::Map::is_empty) {
        return Ok(());
    }
    let latest = match (known, client) {
        (Some(read), _) => Some(read),
        (None, Some(client)) => client.call(READS_QUERY, &json!({ "userBookId": user_book }))?["user_book_reads"][0]["id"].as_i64(),
        (None, None) => None,
    };
    match latest {
        Some(read) => send(client, "update_user_book_read", UPDATE_READ, &json!({ "id": read, "object": patch })).map(|_| ()),
        None => send(client, "insert_user_book_read", INSERT_READ, &json!({ "userBookId": user_book, "object": patch })).map(|_| ()),
    }
}

/// Pulls again after a change, so the database shows what Hardcover now says.
fn then_refresh(session: &Session, client: Option<&Client>) -> Result<()> {
    client.map_or(Ok(()), |client| refresh(session, client))
}

pub fn rate(session: &Session, args: &Args) -> Result<()> {
    let (user_book, _, title) = shelved_named(&session.db, args.positional(0))?;
    let rating: f64 = args.positional(1).replace(',', ".").parse().with_context(|| format!("«{}» is not a rating", args.positional(1)))?;
    if !(0.5..=5.0).contains(&rating) || (rating * 2.0).fract() != 0.0 {
        bail!("the rating {rating} is not from 0.5 to 5 in half steps");
    }
    let client = writer(args)?;
    println!("rating {title}: {rating}");
    send(client.as_ref(), "update_user_book", UPDATE_SHELVED, &json!({ "id": user_book, "object": shelved_patch(None, Some(rating))? }))?;
    then_refresh(session, client.as_ref())
}

pub fn status(session: &Session, args: &Args) -> Result<()> {
    let (user_book, _, title) = shelved_named(&session.db, args.positional(0))?;
    let patch = shelved_patch(Some(args.positional(1)), None)?;
    let client = writer(args)?;
    println!("moving {title} to {}", args.positional(1));
    send(client.as_ref(), "update_user_book", UPDATE_SHELVED, &json!({ "id": user_book, "object": patch }))?;
    then_refresh(session, client.as_ref())
}

pub fn read(session: &Session, args: &Args) -> Result<()> {
    let (user_book, _, title) = shelved_named(&session.db, args.positional(0))?;
    let (started, finished) = (day_argument(args.positional(1))?, day_argument(args.positional(2))?);
    let pages = blank(args.positional(3)).filter(|text| *text != "-").map(|text| text.parse::<i64>().with_context(|| format!("«{text}» is not a number of pages"))).transpose()?;
    let patch = read_patch(started.as_deref(), finished.as_deref(), pages);
    if patch.as_object().is_some_and(serde_json::Map::is_empty) {
        bail!("give a start day, a finish day or the pages («-» for none): at least one");
    }
    let client = writer(args)?;
    println!("dates of {title}");
    // The latest read is the one the last pull stored; a book with none gets its first.
    let latest = session.db.query("SELECT max(read_id) AS id FROM hardcover_read WHERE user_book_id = ?", &[json!(user_book)])?.first().and_then(|row| row["id"].as_i64());
    set_read(client.as_ref(), user_book, latest, &patch)?;
    then_refresh(session, client.as_ref())
}

/// The book Hardcover has for a title and year: its number, or what to choose from.
fn find_book(client: &Client, title: &str, year: i64) -> Result<i64> {
    let ids: Vec<i64> = client.call(SEARCH_QUERY, &json!({ "query": title }))?["search"]["ids"].as_array().into_iter().flatten().filter_map(|id| id.as_i64().or_else(|| id.as_str()?.parse().ok())).collect();
    if ids.is_empty() {
        bail!("Hardcover has no book for «{title}»");
    }
    let books = client.call(BOOKS_QUERY, &json!({ "ids": ids }))?;
    let hits: Vec<Hit> = ids
        .iter()
        .enumerate()
        .filter_map(|(rank, id)| {
            let book = books["books"].as_array()?.iter().find(|book| book["id"].as_i64() == Some(*id))?;
            Some(Hit { ext_id: id.to_string(), title: book["title"].as_str()?.to_string(), year: book["release_year"].as_i64(), popularity: -f64::from(u32::try_from(rank).unwrap_or(u32::MAX)) })
        })
        .collect();
    match pick(&hits, title, year) {
        Found::Number(id) => id.parse().with_context(|| format!("«{id}» is not a Hardcover number")),
        Found::Candidates(candidates) => bail!("no sure match for «{title}»: {}", candidates.iter().map(|hit| format!("«{}» {} ({})", hit.title, hit.year.map_or_else(String::new, |year| year.to_string()), hit.ext_id)).collect::<Vec<_>>().join("; ")),
    }
}

/// Puts a book on a shelf, and its rating and dates with it; a book already shelved is found and updated instead.
fn shelve_book(client: Option<&Client>, book: i64, entry: &Entry) -> Result<()> {
    let shelf = shelf_of(&entry.status)?;
    let inserted = send(client, "insert_user_book", INSERT_SHELVED, &json!({ "object": { "book_id": book, "status_id": shelf } }))?;
    let created = inserted["user_book"]["id"].as_i64();
    let user_book = match (client, created) {
        (_, Some(id)) => id,
        (Some(client), None) => client.call(FIND_SHELVED_QUERY, &json!({ "bookId": book }))?["me"]["user_books"][0]["id"].as_i64().with_context(|| format!("book {book} is not on your shelves after the insert"))?,
        (None, None) => 0,
    };
    // A book that was already shelved keeps its shelf unless the status is sent again, and the rating goes either way.
    if (client.is_some() && created.is_none()) || entry.rating.is_some() {
        send(client, "update_user_book", UPDATE_SHELVED, &json!({ "id": user_book, "object": shelved_patch(Some(&entry.status), entry.rating)? }))?;
    }
    // A book put on the read shelf gets today as its day from Hardcover unless the real one is sent.
    let finished = if entry.status == "done" { entry.on_date.as_deref() } else { None };
    let started = if entry.status == "reading" { entry.on_date.as_deref() } else { None };
    set_read(client, user_book, None, &read_patch(started, finished, entry.amount.and_then(|pages| pages.round().to_string().parse().ok())))
}

pub fn shelve(session: &Session, args: &Args) -> Result<()> {
    let year = args.positional(1).parse::<i64>().unwrap_or(0);
    let status = args.positional(2);
    shelf_of(status)?;
    let client = writer(args)?;
    let book = match &client {
        Some(client) => find_book(client, args.positional(0), year)?,
        None => 0,
    };
    println!("shelving {} as {status} (Hardcover book {book})", args.positional(0));
    shelve_book(client.as_ref(), book, &Entry { title: args.positional(0).to_string(), status: status.to_string(), ..Entry::default() })?;
    then_refresh(session, client.as_ref())
}

/// Sends the log's own lines and the collection's wanted books, those Hardcover does not have, and writes Hardcover's number
/// into each line it sent, so that the next pull lays Hardcover over it. A finished book with no day is left out: Hardcover
/// would give it today's. A book that is only owned is on no shelf.
pub fn push(session: &Session, args: &Args) -> Result<()> {
    let client = writer(args)?;
    let (mut sent, mut skipped) = (0, 0);
    for (ledger, path) in [(Ledger::Log, &session.log), (Ledger::Collection, &session.collection)] {
        if ledger == Ledger::Collection && !path.exists() {
            continue;
        }
        let entries = session.shelf.read_in(ledger, &session.shelf.read_file(path)?)?;
        let mut sources = Vec::new();
        for (line, entry) in entries.iter().enumerate() {
            if entry.source.as_ref().is_some_and(|source| source.starts_with("hardcover:")) || entry.status == "owned" {
                continue;
            }
            if entry.status == "done" && entry.on_date.is_none() {
                println!("left out (a finished book with no day): {}", entry.title);
                skipped += 1;
                continue;
            }
            let book = match &client {
                Some(client) => match find_book(client, &entry.title, entry.year.unwrap_or(0)) {
                    Ok(book) => book,
                    Err(error) => {
                        println!("left out: {error:#}");
                        skipped += 1;
                        continue;
                    }
                },
                None => 0,
            };
            println!("sending {} as {}", entry.title, entry.status);
            shelve_book(client.as_ref(), book, entry)?;
            sources.push((line, format!("hardcover:{book}")));
            sent += 1;
        }
        if client.is_some() {
            session.shelf.set_sources(path, "hardcover", &sources)?;
        }
    }
    if let Some(client) = &client {
        refresh(session, client)?;
    }
    println!("push-hardcover: {sent} sent, {skipped} left out{}", if client.is_none() { " (dry run: nothing was sent)" } else { "" });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use shared_data::app_db::memory_with_schema;

    #[test]
    fn retries_server_errors_and_rate_limits_but_not_client_errors() {
        use reqwest::StatusCode;
        assert!(is_transient(StatusCode::SERVICE_UNAVAILABLE));
        assert!(is_transient(StatusCode::BAD_GATEWAY));
        assert!(is_transient(StatusCode::TOO_MANY_REQUESTS));
        assert!(!is_transient(StatusCode::UNAUTHORIZED));
        assert!(!is_transient(StatusCode::OK));
    }

    #[test]
    fn waits_grow_and_stop_growing() {
        let waits: Vec<u64> = (1..=6).map(|attempt| retry_wait(attempt).as_secs()).collect();
        assert_eq!(waits, [10, 20, 40, 80, 160, 160]);
    }

    const SCHEMA: &str = include_str!("../../../../db/books.sql");

    fn answer() -> Vec<Value> {
        vec![
            json!({"id": 11, "status_id": 3, "rating": 4.25, "date_added": "2024-01-01T00:00:00Z", "book": {"id": 7, "title": " Dune ", "release_year": 1965, "pages": 612},
                "user_book_reads": [{"id": 31, "started_at": "2024-02-01", "finished_at": "2024-03-05", "progress_pages": null}]}),
            json!({"id": 12, "status_id": 2, "rating": null, "date_added": "2024-04-01", "book": {"id": 8, "title": "Emma", "release_year": null, "pages": 400},
                "user_book_reads": [{"id": 32, "started_at": "2024-04-02", "finished_at": null, "progress_pages": 120}]}),
            json!({"id": 13, "status_id": 1, "rating": 0, "date_added": "2024-04-01", "book": {"id": 9, "title": "Ulysses", "release_year": 1922, "pages": 700}, "user_book_reads": []}),
            json!({"id": 14, "status_id": 6, "rating": null, "date_added": "2024-04-01", "book": {"id": 10, "title": "Ignored"}, "user_book_reads": []}),
        ]
    }

    fn mirrored() -> SqliteClient {
        let db = memory_with_schema(SCHEMA);
        store(&db, &answer()).unwrap_or_else(|error| panic!("{error:#}"));
        db
    }

    #[test]
    fn the_tables_are_exactly_what_the_api_returned_and_a_second_pull_replaces_them() {
        let db = mirrored();
        let count = |table: &str| db.query(&format!("SELECT count(*) AS n FROM {table}"), &[]).unwrap_or_default()[0]["n"].clone();
        assert_eq!((count("hardcover_book"), count("hardcover_read")), (json!(4), json!(2)));
        store(&db, &answer()[..1]).unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!((count("hardcover_book"), count("hardcover_read")), (json!(1), json!(1)));
        let book = &db.query("SELECT title, rating, status_id FROM hardcover_book", &[]).unwrap_or_default()[0];
        assert_eq!((book["title"].as_str(), book["rating"].as_f64(), book["status_id"].as_i64()), (Some("Dune"), Some(4.25), Some(3)));
    }

    #[test]
    fn hardcover_wins_over_a_log_line_with_its_number_and_adds_the_books_the_log_lacks() {
        let db = mirrored();
        // The log has Dune as Hardcover's (edited: another rating and a note), and a book of its own.
        let log = "date,title,year,status,rating,amount,note,ext_id,source\n2020-01-01,Dune,1965,done,2,100,my note,,hardcover:7\n2026-01-01,Own book,2001,done,5,,,,\n";
        let shelf = Shelf { prefix: "book", name: "books log", statuses: &["done", "reading", "dropped"], added_as: "done", overlay: Some(overlay), made_by: "test" };
        shelf.replace(&db, &shelf.read(log).unwrap_or_else(|error| panic!("{error:#}"))).unwrap_or_else(|error| panic!("{error:#}"));
        let rows = db.query("SELECT title, status, rating, on_date, amount, note, source FROM book_entry ORDER BY id", &[]).unwrap_or_default();
        let line = |index: usize| (rows[index]["title"].as_str().unwrap_or_default().to_string(), rows[index]["status"].as_str().unwrap_or_default().to_string(), rows[index]["rating"].as_f64(), rows[index]["on_date"].as_str().map(str::to_string), rows[index]["amount"].as_f64());
        assert_eq!(rows.len(), 3, "the two log lines and Emma; Ulysses is wanted, so it is in the collection, and the ignored one is left out");
        // Dune: the log's own title and note stay, Hardcover's rating, day and pages win.
        assert_eq!(line(0), ("Dune".to_string(), "done".to_string(), Some(4.5), Some("2024-03-05".to_string()), Some(612.0)));
        assert_eq!(rows[0]["note"].as_str(), Some("my note"));
        assert_eq!(line(1).2, Some(5.0));
        assert_eq!(line(2), ("Emma".to_string(), "reading".to_string(), None, Some("2024-04-02".to_string()), Some(120.0)));
        let wanted = db.query("SELECT title, status FROM book_collection", &[]).unwrap_or_default();
        assert_eq!((wanted.len(), wanted[0]["title"].as_str(), wanted[0]["status"].as_str()), (1, Some("Ulysses"), Some("want")));
        // Importing again changes nothing: the same lines.
        shelf.replace(&db, &shelf.read(log).unwrap_or_else(|error| panic!("{error:#}"))).unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!(db.query("SELECT count(*) AS n FROM book_entry", &[]).unwrap_or_default()[0]["n"], json!(3));
        assert_eq!(db.query("SELECT count(*) AS n FROM book_collection", &[]).unwrap_or_default()[0]["n"], json!(1));
    }

    #[test]
    fn a_title_names_one_shelved_book_or_says_why_not() {
        let db = mirrored();
        assert_eq!(shelved_named(&db, "dune").unwrap_or_else(|error| panic!("{error:#}")).1, 7);
        assert_eq!(shelved_named(&db, "ulys").unwrap_or_else(|error| panic!("{error:#}")).1, 9);
        let none = format!("{:#}", shelved_named(&db, "Nothing").err().unwrap_or_else(|| panic!("a missing book was found")));
        assert!(none.contains("shelve it"), "{none}");
        db.execute("INSERT INTO hardcover_book (user_book_id, book_id, title, status_id, fetched_at) VALUES (99, 70, 'Dune Messiah', 1, 0)", &[]).unwrap_or_else(|error| panic!("{error:#}"));
        // «Dune» is spelled exactly like one of them, so it is that one; «Du» is both.
        assert_eq!(shelved_named(&db, "Dune").unwrap_or_else(|error| panic!("{error:#}")).1, 7);
        let both = format!("{:#}", shelved_named(&db, "Du").err().unwrap_or_else(|| panic!("an ambiguous title was accepted")));
        assert!(both.contains("more than one"), "{both}");
    }

    #[test]
    fn a_change_sends_only_what_was_given_and_a_wrong_status_is_refused() {
        assert_eq!(shelved_patch(Some("done"), None).unwrap_or_default(), json!({"status_id": 3}));
        assert_eq!(shelved_patch(None, Some(4.5)).unwrap_or_default(), json!({"rating": 4.5}));
        assert!(shelved_patch(Some("finished"), None).is_err());
        assert_eq!(read_patch(None, Some("2024-03-05"), Some(300)), json!({"finished_at": "2024-03-05", "progress_pages": 300}));
        assert_eq!(read_patch(None, None, None), json!({}));
        assert_eq!(day_argument("-").unwrap_or_default(), None);
        assert!(day_argument("5 March").is_err());
        assert_eq!((shelf_of("dropped").unwrap_or_default(), status_of(4), status_of(6)), (5, Some("reading"), None));
    }
}
