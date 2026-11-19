//! Keeps the owner's books in the local database: what was read, from the log written by hand (`.data/books-log.csv`,
//! `BOOKS_LOG` names another file) and from Hardcover (which wins, and which it can be written to) and from a Goodreads export, and what the register Open Library says about
//! each book. Run by hand from `apps/books` (`BOOKS_DB` names another database file); the shelves' key is
//! `HARDCOVER_TOKEN`.

mod apple;
mod goodreads;
mod hardcover;
mod openlibrary;
mod schema;

use std::path::Path;

use anyhow::Result;
use shared_data::job::Job;
use shared_data::shelf::{Session, Shelf, Tool};

const TOOL: Tool = Tool {
    program: "books-sync",
    shelf: Shelf { prefix: "book", name: "books log", statuses: &["done", "reading", "dropped"], added_as: "done", overlay: Some(hardcover::overlay), made_by: "books-sync add <title> <year> <date> <rating>" },
    log: ("BOOKS_LOG", "../../.data/books-log.csv"),
    collection: ("BOOKS_COLLECTION", "../../.data/books-collection.csv"),
    database: ("BOOKS_DB", "../../.data/books.db", "books"),
    schema: schema::SCHEMA,
};

fn main() -> Result<()> {
    TOOL.run(vec![
        Job::new("hardcover", "add the books on the Hardcover shelves that the log lacks, then import", |session: &Session, _| hardcover::pull(session)),
        Job::new("rate", "rate a book on your Hardcover shelves (0.5 to 5), then pull (--dry-run: say what would be sent)", |session: &Session, args| hardcover::rate(session, args)).takes(&["title", "rating"]).flags(&["--dry-run"]),
        Job::new("status", "move a book on your Hardcover shelves to want, reading, done or dropped, then pull (--dry-run)", |session: &Session, args| hardcover::status(session, args)).takes(&["title", "status"]).flags(&["--dry-run"]),
        Job::new("read", "set the start day, the finish day and the pages of a book's latest read on Hardcover («-» for none), then pull (--dry-run)", |session: &Session, args| hardcover::read(session, args)).takes(&["title", "started", "finished", "pages"]).flags(&["--dry-run"]),
        Job::new("shelve", "put a book on your Hardcover shelves, found by title and year (0 for none), then pull (--dry-run)", |session: &Session, args| hardcover::shelve(session, args)).takes(&["title", "year", "status"]).flags(&["--dry-run"]),
        Job::new("push-hardcover", "send the log's own books to Hardcover, write its numbers into the log, then pull (--dry-run)", |session: &Session, args| hardcover::push(session, args)).flags(&["--dry-run"]),
        Job::new("purchases", "add the audiobooks of the receipts that mail-ingest landed (`npm run mail:purchases`) to the collection as owned", |session: &Session, _| shared_data::purchases::add(session, shared_data::purchases::Kind::Books)),
        Job::new("apple", "add the books and audiobooks bought in Apple Books (the landed Apple data export, `npm run land -- apple-media <zip>`) to the collection as owned", |session: &Session, _| apple::run(session)),
        Job::new("goodreads", "add the books of a Goodreads library export (a file, or the folder `npm run land -- goodreads` made) that the log lacks, then import", |session, args| goodreads::run(session, Path::new(args.positional(0)))).takes(&["export"]),
        Job::new("openlibrary", "look up each book the log names in Open Library and fetch its details (--everything: all of them again)", |session, args| openlibrary::run(session, args.flag("--everything"))).flags(&["--everything"]),
    ])
}
