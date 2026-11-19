-- boardgames: the board games the owner has played, written by hand in `.data/boardgames-log.csv` (plus what BoardGameGeek adds to it), and what the
-- register says about each (`boardgames-sync`; the originals are under `.data/raw/<source>/<date>/`). Idempotent,
-- applied on every run.

-- One row per line of the log: the log is the record, and `boardgames-sync import-log` makes this table exactly its rows,
-- so a row changed or deleted in the log is changed or deleted here at the next import.
CREATE TABLE IF NOT EXISTS boardgame_entry (
  id INTEGER PRIMARY KEY,
  on_date TEXT,                         -- YYYY-MM-DD, or none when the day is not known
  title TEXT NOT NULL,                  -- as the log writes it
  year INTEGER,                         -- the release year as the log writes it; helps the register find the right one
  status TEXT NOT NULL,                 -- `played`
  rating REAL,                          -- 0.5 to 5 in half steps, or none
  amount REAL,                          -- not used
  note TEXT,
  ext_id TEXT,                          -- BoardGameGeek's number; the way to settle a wrong match
  source TEXT, -- the service's own number for the line (`bgg:<id>`), so a pull never adds it twice
  format TEXT,                          -- what the owner has: cd, vinyl, digital, blu-ray, fysisk; free text, lowercase
  at INTEGER                            -- unix seconds of the moment, where the source knows it; `on_date` is its day
);

CREATE INDEX IF NOT EXISTS idx_boardgame_entry_day ON boardgame_entry (on_date);

-- What the owner has or wants, written by hand in `.data/boardgames-collection.csv` (plus what a service adds to it): one line per work,
-- with the log's columns. `boardgames-sync import-collection` makes this table exactly the file's lines. A work here needs no line in
-- the log: the library is the collection and the log together, and a work in only one of them is still in the library.
CREATE TABLE IF NOT EXISTS boardgame_collection (
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
CREATE TABLE IF NOT EXISTS boardgame_match (
  title TEXT NOT NULL,
  year INTEGER NOT NULL,
  ext_id TEXT,                          -- null when none was found or the answer was ambiguous
  candidates TEXT,                      -- JSON: the first few hits, for the owner to choose from
  tried_at INTEGER NOT NULL,
  PRIMARY KEY (title, year)
);

-- One boardgame, as the register has it.
CREATE TABLE IF NOT EXISTS boardgame_item (
  ext_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  creator TEXT,                         -- the designer
  year INTEGER,
  summary TEXT,                         -- plain text
  cover TEXT,                           -- an address on the register's own image host, http or https
  url TEXT,                             -- its page in the register
  fetched_at INTEGER NOT NULL,
  banner TEXT                           -- a wide picture for behind the work's page: an address on the register's own image host (a game's screenshot, a book's author), none where it has none
);

CREATE TABLE IF NOT EXISTS boardgame_genre (
  ext_id TEXT NOT NULL,
  genre TEXT NOT NULL,
  PRIMARY KEY (ext_id, genre)
);

-- What the register says about a game besides the facts in `boardgame_item`: players, playing time, age, how the register's
-- users rate it and how heavy they find it. Written by `boardgames-sync bgg` from the same `thing` answer, replaced on each fetch.
CREATE TABLE IF NOT EXISTS boardgame_detail (
  ext_id TEXT PRIMARY KEY,
  thumbnail TEXT,                       -- a small cover, an address on the register's own image host
  min_players INTEGER,
  max_players INTEGER,
  playing_time INTEGER,                 -- minutes, as the publisher states it
  min_playtime INTEGER,
  max_playtime INTEGER,
  min_age INTEGER,
  best_players TEXT,                    -- the player counts most voters call best, as `4` or `3-4`
  recommended_players TEXT,             -- the counts most voters call at least recommended, as `2-5`
  rating_average REAL,                  -- 1 to 10
  rating_bayes REAL,
  rating_deviation REAL,
  rating_count INTEGER,
  weight REAL,                          -- the complexity users give it, 1 to 5
  weight_count INTEGER,
  owned_count INTEGER,
  trading_count INTEGER,
  wanting_count INTEGER,
  wishing_count INTEGER,
  comment_count INTEGER
);

-- A person, company or group tied to a game: `kind` is the register's own link type (`boardgamedesigner`, `boardgameartist`,
-- `boardgamepublisher`, `boardgamemechanic`, `boardgamefamily`, `boardgameexpansion`, `boardgameimplementation`,
-- `boardgameintegration`, `boardgamecompilation`, `boardgamecontains`), `bgg_id` its number there.
CREATE TABLE IF NOT EXISTS boardgame_link (
  ext_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  bgg_id TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (ext_id, kind, bgg_id)
);

-- The other names a game goes by: translations and reprints.
CREATE TABLE IF NOT EXISTS boardgame_name (
  ext_id TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (ext_id, name)
);

-- The register's poll on player counts: the votes for each count, `players` as it writes it (`4`, or `6+` for more than the box says).
CREATE TABLE IF NOT EXISTS boardgame_player_poll (
  ext_id TEXT NOT NULL,
  players TEXT NOT NULL,
  best INTEGER NOT NULL,
  recommended INTEGER NOT NULL,
  not_recommended INTEGER NOT NULL,
  PRIMARY KEY (ext_id, players)
);

-- The game's place in each of the register's lists: `name` is `boardgame` for the overall one, else a subtype or family.
CREATE TABLE IF NOT EXISTS boardgame_rank (
  ext_id TEXT NOT NULL,
  name TEXT NOT NULL,
  label TEXT NOT NULL,                  -- the register's own words: «Board Game Rank», «Strategy Game Rank»
  position INTEGER NOT NULL,
  bayes REAL,
  PRIMARY KEY (ext_id, name)
);
