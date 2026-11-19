-- tv: the series the owner has watched, written by hand in `.data/tv-log.csv` (there is no account to fetch them from),
-- one line per episode, and what the TV register TMDB says about each series (`tv-sync tmdb`; the originals are under
-- `.data/raw/tmdb/<date>/`). Idempotent, applied on every run.

-- One row per episode watched, as the log has it: the log is the record, and `tv-sync import-log` makes this table
-- exactly its rows, so a row changed or deleted in the log is changed or deleted here at the next import.
CREATE TABLE IF NOT EXISTS tv_watch (
  id INTEGER PRIMARY KEY,
  watched_on TEXT,                      -- YYYY-MM-DD, or none when the day is not known
  series TEXT NOT NULL,                 -- the series as the log writes it
  year INTEGER,                         -- the first year of the series as the log writes it; helps the register find it
  season INTEGER,                       -- the season of the episode, or none for a viewing of the series as such
  episode INTEGER,                      -- the episode within the season, or none
  rating REAL,                          -- 0.5 to 5 in half steps, or none
  rewatch INTEGER NOT NULL,             -- 1 if the episode had been seen before
  note TEXT,
  tmdb_id INTEGER                       -- the register's number, when the log names it (the way to settle a wrong match)
);

CREATE INDEX IF NOT EXISTS idx_tv_watch_day ON tv_watch (watched_on);

-- What the register answered for a series and year: found, or the candidates to choose from. `year` is 0 for none.
CREATE TABLE IF NOT EXISTS tv_match (
  title TEXT NOT NULL,
  year INTEGER NOT NULL,
  tmdb_id INTEGER,                      -- null when none was found or the answer was ambiguous
  candidates TEXT,                      -- JSON: the first few hits, for the owner to choose from
  tried_at INTEGER NOT NULL,
  PRIMARY KEY (title, year)
);

-- A series, as the register has it (Norwegian where it has that).
CREATE TABLE IF NOT EXISTS tv_title (
  tmdb_id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  original_title TEXT,
  first_air_date TEXT,                  -- YYYY-MM-DD of the first episode
  last_air_date TEXT,                   -- YYYY-MM-DD of the last episode the register knows
  number_of_seasons INTEGER,
  number_of_episodes INTEGER,
  episode_runtime_min INTEGER,          -- the usual running time of an episode
  overview TEXT,                        -- plain text
  tagline TEXT,
  poster_path TEXT,                     -- the file name under image.tmdb.org, with a leading slash
  backdrop_path TEXT,                   -- the wide picture, the same way
  original_language TEXT,
  status TEXT,                          -- the register's wording: Returning Series, Ended, …
  in_production INTEGER,                -- 1 while the register says more episodes are coming
  homepage TEXT,
  fetched_at INTEGER NOT NULL,
  vote_average REAL,                    -- the register's own average, 0 to 10
  vote_count INTEGER,
  imdb_id TEXT,
  wikidata_id TEXT
);

CREATE TABLE IF NOT EXISTS tv_genre (
  tmdb_id INTEGER NOT NULL,
  genre TEXT NOT NULL,
  PRIMARY KEY (tmdb_id, genre)
);

-- The languages spoken in a series, by ISO 639-1 code, with the register's English name.
CREATE TABLE IF NOT EXISTS tv_language (
  tmdb_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  language TEXT NOT NULL,
  PRIMARY KEY (tmdb_id, code)
);

CREATE TABLE IF NOT EXISTS tv_country (
  tmdb_id INTEGER NOT NULL,
  code TEXT NOT NULL,                   -- ISO 3166-1
  country TEXT NOT NULL,
  PRIMARY KEY (tmdb_id, code)
);

-- The channel or service a series belongs to, as the register has it: where the tv pages say a series was seen.
CREATE TABLE IF NOT EXISTS tv_network (
  tmdb_id INTEGER NOT NULL,
  network_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  country TEXT,                         -- ISO 3166-1 of where it is based
  position INTEGER NOT NULL,            -- the order the register lists its networks in
  PRIMARY KEY (tmdb_id, network_id)
);

-- The people of a series: the first of its cast (`job` is `Cast`, in billing order) and its crew by `Creator`,
-- `Writer`, `Producer`, `Composer`, `Editor` or `Cinematography` (the register's many job names folded into these).
CREATE TABLE IF NOT EXISTS tv_credit (
  tmdb_id INTEGER NOT NULL,
  person_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  job TEXT NOT NULL,
  character TEXT,
  position INTEGER NOT NULL,
  PRIMARY KEY (tmdb_id, person_id, job)
);

CREATE INDEX IF NOT EXISTS idx_tv_credit_person ON tv_credit (person_id);

CREATE TABLE IF NOT EXISTS tv_company (
  tmdb_id INTEGER NOT NULL,
  company TEXT NOT NULL,
  country TEXT,                         -- ISO 3166-1 of where it is based
  PRIMARY KEY (tmdb_id, company)
);

-- The works TMDB recommends beside a series, best first (`position` 0 is the best): enough to show each without asking again.
-- A recommended series the owner has seen is told by its number in `tv_watch` or the log's match.
CREATE TABLE IF NOT EXISTS tv_related (
  tmdb_id INTEGER NOT NULL,
  related_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  day TEXT,                             -- YYYY-MM-DD of the first episode, where the register has one
  poster_path TEXT,
  position INTEGER NOT NULL,
  PRIMARY KEY (tmdb_id, related_id)
);

CREATE TABLE IF NOT EXISTS tv_keyword (
  tmdb_id INTEGER NOT NULL,
  keyword TEXT NOT NULL,
  PRIMARY KEY (tmdb_id, keyword)
);

-- A person of a credit, as the register has them. Public figures only: the register is the source, nothing is typed here.
CREATE TABLE IF NOT EXISTS tv_person (
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

-- The episodes of each series the log names, one season at a time as the register lists them (`tv-sync tmdb`): what an
-- episode is called, the day it came out and how long it is. Nothing is typed here.
CREATE TABLE IF NOT EXISTS tv_episode (
  tmdb_id INTEGER NOT NULL,
  season INTEGER NOT NULL,
  episode INTEGER NOT NULL,
  name TEXT,
  air_date TEXT,                        -- YYYY-MM-DD, none for an episode the register has no day for
  runtime_min INTEGER,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (tmdb_id, season, episode)
);

-- When the next episode of a series comes out, from TVmaze (`tv-sync tvmaze`; the originals are under
-- `.data/raw/tvmaze/<date>/`). TMDB lists no coming episode, TVmaze does. A series TVmaze does not know has no row.
CREATE TABLE IF NOT EXISTS tv_next (
  tmdb_id INTEGER PRIMARY KEY,
  tvmaze_id INTEGER NOT NULL,
  next_season INTEGER,                  -- none when no episode is announced
  next_episode INTEGER,
  next_name TEXT,
  next_air_date TEXT,                   -- YYYY-MM-DD
  fetched_at INTEGER NOT NULL
);

-- What the owner has or wants, written by hand in `.data/tv-collection.csv`: one line per series. `tv-sync import-collection`
-- makes this table exactly the file's lines. A series here that the log also has is owned and seen; one the log lacks is
-- owned or wanted and not yet seen. `tmdb_id` settles a wrong match, as in the log.
CREATE TABLE IF NOT EXISTS tv_collection (
  id INTEGER PRIMARY KEY,
  added_on TEXT,                        -- YYYY-MM-DD, or none when the day is not known
  series TEXT NOT NULL,
  year INTEGER,
  status TEXT NOT NULL CHECK (status IN ('owned', 'want')),
  rating REAL,                          -- 0.5 to 5 in half steps, or none
  note TEXT,
  tmdb_id INTEGER,
  format TEXT                           -- what the owner has: cd, vinyl, digital, blu-ray, fysisk; free text, lowercase
);

-- What Apple TV (the app and Apple TV+) says was watched, from Apple's own data export (`import-apple`, original under
-- .data/raw/apple-media/): one row per span watched, not matched to TMDB and not part of `tv_watch`, which is the hand-kept log.
-- A film is a row with no season and episode. Trailers and promos are left out.
CREATE TABLE IF NOT EXISTS apple_tv_play (
  started_at INTEGER NOT NULL, -- unix seconds
  feature_title TEXT NOT NULL, -- the catalogue's own title, e.g. «Severance S2E6 Attila VSN A000590200601»
  ended_at INTEGER,
  show TEXT NOT NULL,
  season INTEGER,
  episode INTEGER,
  episode_title TEXT,
  content_ms INTEGER,
  play_ms INTEGER, -- time watched, pauses and skips not counted
  max_position_ms INTEGER, -- how far into the feature the span reached
  provider TEXT,
  PRIMARY KEY (started_at, feature_title)
);

-- How far TMDB's change lists vouch for what is stored, per list (`titles`, `people`): a row fetched at or after
-- `covered_from` is unchanged unless a list read since then named it. `checked_at` is when the lists were last read;
-- the next read starts there, so the cover stays unbroken from one weekly refresh to the next (`Refresh::Changed`).
CREATE TABLE IF NOT EXISTS tv_tmdb_checked (
  list TEXT PRIMARY KEY,
  covered_from INTEGER NOT NULL,
  checked_at INTEGER NOT NULL
);
