-- film: the films the owner has watched, written by hand in `.data/film-log.csv` (there is no account to fetch them
-- from), and what the film register TMDB says about each (`film-sync tmdb`; the originals are under
-- `.data/raw/tmdb/<date>/`). Idempotent, applied on every run.

-- One row per viewing, as the log has it: the log is the record, and `film-sync import-log` makes this table
-- exactly its rows, so a row changed or deleted in the log is changed or deleted here at the next import.
CREATE TABLE IF NOT EXISTS film_watch (
  id INTEGER PRIMARY KEY,
  watched_on TEXT,                      -- YYYY-MM-DD, or none when the day is not known
  title TEXT NOT NULL,                  -- as the log writes it
  year INTEGER,                         -- the release year as the log writes it; helps the register find the right film
  rating REAL,                          -- 0.5 to 5 in half steps, or none
  rewatch INTEGER NOT NULL,             -- 1 if it had been seen before
  note TEXT,
  tmdb_id INTEGER,                      -- the register's number, when the log names it (the way to settle a wrong match)
  cinema TEXT,                          -- where it was seen, when it was in a cinema
  seat TEXT                             -- where in the hall, when the ticket said: «Sal 1, rad 10, sete 7»
);

CREATE INDEX IF NOT EXISTS idx_film_watch_day ON film_watch (watched_on);

-- The cinemas, written by hand in `.data/film-cinemas.csv`: `film-sync import-cinemas` makes this table exactly its rows.
-- A viewing's `cinema` is the `name` of one of them.
CREATE TABLE IF NOT EXISTS film_cinema (
  name TEXT PRIMARY KEY,
  owner TEXT,                           -- the company or body that runs it
  country TEXT NOT NULL,                -- ISO 3166-1 alpha-2
  city TEXT,
  website TEXT,                         -- its own address, http or https
  image TEXT                            -- a photo of it on its own site: the address the film app lands it from
);

-- The cinema visits the calendar has from today on, shown as upcoming: `film-sync import-calendar` makes this table
-- exactly the `Kino` calendar's visits from today on. A visit that has passed becomes a line of the log instead.
CREATE TABLE IF NOT EXISTS film_planned (
  uid TEXT PRIMARY KEY,
  on_date TEXT NOT NULL,                -- YYYY-MM-DD
  at_time TEXT,                         -- HH:MM, or none for a whole day
  title TEXT NOT NULL,
  cinema TEXT                           -- the name of a cinema of film_cinema, when the event names one
);

-- What the register answered for a title and year: found, or the candidates to choose from. `year` is 0 for none.
CREATE TABLE IF NOT EXISTS film_match (
  title TEXT NOT NULL,
  year INTEGER NOT NULL,
  tmdb_id INTEGER,                      -- null when none was found or the answer was ambiguous
  candidates TEXT,                      -- JSON: the first few hits, for the owner to choose from
  tried_at INTEGER NOT NULL,
  PRIMARY KEY (title, year)
);

-- A film, as the register has it (Norwegian where it has that).
CREATE TABLE IF NOT EXISTS film_title (
  tmdb_id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  original_title TEXT,
  release_date TEXT,
  runtime_min INTEGER,
  overview TEXT,                        -- plain text
  tagline TEXT,
  poster_path TEXT,                     -- the file name under image.tmdb.org, with a leading slash
  backdrop_path TEXT,                   -- the wide picture, the same way
  original_language TEXT,
  fetched_at INTEGER NOT NULL,
  vote_average REAL,                    -- the register's own average, 0 to 10
  vote_count INTEGER,
  budget INTEGER,                       -- US dollars, as the register has it; none where unknown
  revenue INTEGER,
  imdb_id TEXT,
  wikidata_id TEXT,
  certification TEXT,                   -- the Norwegian age rating, e.g. «11»
  released_no TEXT,                     -- YYYY-MM-DD of the Norwegian release
  collection_id INTEGER,                -- the series the film belongs to
  collection TEXT
);

-- The languages spoken in a film, by ISO 639-1 code, with the register's English name.
CREATE TABLE IF NOT EXISTS film_language (
  tmdb_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  language TEXT NOT NULL,
  PRIMARY KEY (tmdb_id, code)
);

CREATE TABLE IF NOT EXISTS film_genre (
  tmdb_id INTEGER NOT NULL,
  genre TEXT NOT NULL,
  PRIMARY KEY (tmdb_id, genre)
);

CREATE TABLE IF NOT EXISTS film_country (
  tmdb_id INTEGER NOT NULL,
  code TEXT NOT NULL,                   -- ISO 3166-1
  country TEXT NOT NULL,
  PRIMARY KEY (tmdb_id, code)
);

-- The people of a film: the first of its cast (`job` is `Cast`, in billing order) and its crew by `Director`, `Writer`,
-- `Cinematography`, `Composer`, `Editor` or `Producer` (the register's many job names folded into these).
CREATE TABLE IF NOT EXISTS film_credit (
  tmdb_id INTEGER NOT NULL,
  person_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  job TEXT NOT NULL,
  character TEXT,
  position INTEGER NOT NULL,
  PRIMARY KEY (tmdb_id, person_id, job)
);

CREATE INDEX IF NOT EXISTS idx_film_credit_person ON film_credit (person_id);

CREATE TABLE IF NOT EXISTS film_company (
  tmdb_id INTEGER NOT NULL,
  company TEXT NOT NULL,
  country TEXT,                         -- ISO 3166-1 of where it is based
  PRIMARY KEY (tmdb_id, company)
);

-- The franchises (TMDB calls them collections) the films belong to, and every part of each with the day it came out, so a page can say how
-- much of a franchise has been seen and what is left. `film-sync franchises` fills them from the numbers in `film_title.collection_id`.
CREATE TABLE IF NOT EXISTS film_franchise (
  franchise_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,                   -- in Norwegian where the register has it, else English
  overview TEXT,
  poster_path TEXT,
  fetched_at INTEGER NOT NULL,
  backdrop_path TEXT                    -- the wide picture, the same way as a film's
);

CREATE TABLE IF NOT EXISTS film_franchise_part (
  franchise_id INTEGER NOT NULL,
  tmdb_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  day TEXT,                             -- YYYY-MM-DD of the release, where the register has one
  poster_path TEXT,
  position INTEGER NOT NULL,            -- 0 is the first part, by release day
  PRIMARY KEY (franchise_id, tmdb_id)
);

-- The works TMDB recommends beside a film, best first (`position` 0 is the best): enough to show each without asking again.
-- A recommended film the owner has seen is told by its number in `film_watch` or the log's match.
CREATE TABLE IF NOT EXISTS film_related (
  tmdb_id INTEGER NOT NULL,
  related_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  day TEXT,                             -- YYYY-MM-DD of the release, where the register has one
  poster_path TEXT,
  position INTEGER NOT NULL,
  PRIMARY KEY (tmdb_id, related_id)
);

CREATE TABLE IF NOT EXISTS film_keyword (
  tmdb_id INTEGER NOT NULL,
  keyword TEXT NOT NULL,
  PRIMARY KEY (tmdb_id, keyword)
);

-- A person of a credit, as the register has them. Public figures only: the register is the source, nothing is typed here.
CREATE TABLE IF NOT EXISTS film_person (
  person_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  birthday TEXT,                        -- YYYY-MM-DD
  deathday TEXT,
  place_of_birth TEXT,
  biography TEXT,                       -- plain text, in Norwegian where the register has it, else English
  biography_language TEXT,              -- `nb` or `en`
  department TEXT,                      -- what they are known for, e.g. Acting
  imdb_id TEXT,
  fetched_at INTEGER NOT NULL
);

-- What the owner has or wants, written by hand in `.data/film-collection.csv`: one line per film. `film-sync import-collection`
-- makes this table exactly the file's lines. A film here that the log also has is owned and seen; one the log lacks is owned
-- or wanted and not yet seen. `tmdb_id` settles a wrong match, as in the log.
CREATE TABLE IF NOT EXISTS film_collection (
  id INTEGER PRIMARY KEY,
  added_on TEXT,                        -- YYYY-MM-DD, or none when the day is not known
  title TEXT NOT NULL,
  year INTEGER,
  status TEXT NOT NULL CHECK (status IN ('owned', 'want')),
  rating REAL,                          -- 0.5 to 5 in half steps, or none
  note TEXT,
  tmdb_id INTEGER,
  format TEXT                           -- what the owner has: cd, vinyl, digital, blu-ray, fysisk; free text, lowercase
);

-- How far TMDB's change lists vouch for what is stored, per list (`titles`, `people`): a row fetched at or after
-- `covered_from` is unchanged unless a list read since then named it. `checked_at` is when the lists were last read;
-- the next read starts there, so the cover stays unbroken from one weekly refresh to the next (`Refresh::Changed`).
CREATE TABLE IF NOT EXISTS film_tmdb_checked (
  list TEXT PRIMARY KEY,
  covered_from INTEGER NOT NULL,
  checked_at INTEGER NOT NULL
);
