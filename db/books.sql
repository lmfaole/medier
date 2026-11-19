-- books: the books the owner has read, written by hand in `.data/books-log.csv` (plus what Hardcover adds to it), and what the
-- register says about each (`books-sync`; the originals are under `.data/raw/<source>/<date>/`). Idempotent,
-- applied on every run.

-- One row per line of the log: the log is the record, and `books-sync import-log` makes this table exactly its rows,
-- so a row changed or deleted in the log is changed or deleted here at the next import.
CREATE TABLE IF NOT EXISTS book_entry (
  id INTEGER PRIMARY KEY,
  on_date TEXT,                         -- YYYY-MM-DD, or none when the day is not known
  title TEXT NOT NULL,                  -- as the log writes it
  year INTEGER,                         -- the release year as the log writes it; helps the register find the right one
  status TEXT NOT NULL,                 -- `reading`, `done` or `dropped`
  rating REAL,                          -- 0.5 to 5 in half steps, or none
  amount REAL,                          -- pages read, or the book's length when it is done
  note TEXT,
  ext_id TEXT,                          -- Open Library's work number, e.g. `OL82563W`; the way to settle a wrong match
  source TEXT, -- the service's own number for the line (`hardcover:<id>`), so a pull never adds it twice
  format TEXT,                          -- what the owner has: cd, vinyl, digital, blu-ray, fysisk; free text, lowercase
  at INTEGER                            -- unix seconds of the moment, where the source knows it; `on_date` is its day
);

CREATE INDEX IF NOT EXISTS idx_book_entry_day ON book_entry (on_date);

-- What the owner has or wants, written by hand in `.data/books-collection.csv` (plus what a service adds to it): one line per work,
-- with the log's columns. `books-sync import-collection` makes this table exactly the file's lines. A work here needs no line in
-- the log: the library is the collection and the log together, and a work in only one of them is still in the library.
CREATE TABLE IF NOT EXISTS book_collection (
  id INTEGER PRIMARY KEY,
  on_date TEXT,                         -- YYYY-MM-DD the work was added, or none when the day is not known
  title TEXT NOT NULL,
  year INTEGER,
  status TEXT NOT NULL CHECK (status IN ('owned', 'want')),
  rating REAL,                          -- 0.5 to 5 in half steps, or none
  amount REAL,                          -- as in the log; none for a work not started
  note TEXT,
  ext_id TEXT,                          -- the register's number; the way to settle a wrong match
  source TEXT,                          -- the service's own number for the line, so a pull never adds it twice
  format TEXT,                          -- what the owner has: cd, vinyl, digital, blu-ray, fysisk; free text, lowercase
  at INTEGER                            -- as in the log
);

-- What the register answered for a title and year: found, or the candidates to choose from. `year` is 0 for none.
CREATE TABLE IF NOT EXISTS book_match (
  title TEXT NOT NULL,
  year INTEGER NOT NULL,
  ext_id TEXT,                          -- null when none was found or the answer was ambiguous
  candidates TEXT,                      -- JSON: the first few hits, for the owner to choose from
  tried_at INTEGER NOT NULL,
  PRIMARY KEY (title, year)
);

-- One book, as the register has it.
CREATE TABLE IF NOT EXISTS book_item (
  ext_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  creator TEXT,                         -- the author
  year INTEGER,
  summary TEXT,                         -- plain text
  cover TEXT,                           -- an address on the register's own image host, http or https
  url TEXT,                             -- its page in the register
  fetched_at INTEGER NOT NULL,
  banner TEXT                           -- a wide picture for behind the work's page: an address on the register's own image host (a game's screenshot, a book's author), none where it has none
);

-- What Open Library and Wikidata say of a book beyond its facts in `book_item` (`books-sync openlibrary`): the pages the
-- editions usually have and the country of its first author's citizenship, by way of the author's Wikidata entry. A book they say nothing of still gets a row (all NULL).
CREATE TABLE IF NOT EXISTS book_fact (
  ext_id TEXT PRIMARY KEY,
  pages INTEGER,
  languages TEXT,                       -- ISO 639-2 codes, comma-separated
  author_country TEXT,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS book_genre (
  ext_id TEXT NOT NULL,
  genre TEXT NOT NULL,
  PRIMARY KEY (ext_id, genre)
);

-- Hardcover, as its API returns it (`books-sync hardcover`; the originals are under `.data/raw/hardcover/<date>/`): every
-- pull makes these two tables exactly the shelves and reads Hardcover has. Hardcover wins over the log for these books:
-- `book_entry` takes their status, rating, day and pages from here (`hardcover::overlay`), whatever the log says.
CREATE TABLE IF NOT EXISTS hardcover_book (
  user_book_id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  release_year INTEGER,
  pages INTEGER,
  status_id INTEGER NOT NULL,           -- 1 want to read, 2 reading, 3 read, 4 paused, 5 did not finish, 6 ignored
  rating REAL,                          -- 0 to 5, or none
  date_added TEXT,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hardcover_read (
  read_id INTEGER PRIMARY KEY,
  user_book_id INTEGER NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  progress_pages INTEGER
);
