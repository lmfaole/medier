-- games: the video games the owner has played, written by hand in `.data/games-log.csv` (plus what Steam adds to it), and what the
-- register says about each (`games-sync`; the originals are under `.data/raw/<source>/<date>/`). Idempotent,
-- applied on every run.

-- One row per line of the log: the log is the record, and `games-sync import-log` makes this table exactly its rows,
-- so a row changed or deleted in the log is changed or deleted here at the next import.
CREATE TABLE IF NOT EXISTS game_entry (
  id INTEGER PRIMARY KEY,
  on_date TEXT,                         -- YYYY-MM-DD, or none when the day is not known
  title TEXT NOT NULL,                  -- as the log writes it
  year INTEGER,                         -- the release year as the log writes it; helps the register find the right one
  status TEXT NOT NULL,                 -- `playing`, `done` or `dropped`
  rating REAL,                          -- 0.5 to 5 in half steps, or none
  amount REAL,                          -- hours played, as the log or Steam says
  note TEXT,
  ext_id TEXT,                          -- IGDB's number; the way to settle a wrong match
  source TEXT, -- the service's own number for the line (`steam:<appid>`), so a pull never adds it twice
  format TEXT,                          -- what the owner has: cd, vinyl, digital, blu-ray, fysisk; free text, lowercase
  at INTEGER                            -- unix seconds of the moment, where the source knows it; `on_date` is its day
);

CREATE INDEX IF NOT EXISTS idx_game_entry_day ON game_entry (on_date);

-- What the owner has or wants, written by hand in `.data/games-collection.csv` (plus what a service adds to it): one line per work,
-- with the log's columns. `games-sync import-collection` makes this table exactly the file's lines. A work here needs no line in
-- the log: the library is the collection and the log together, and a work in only one of them is still in the library.
CREATE TABLE IF NOT EXISTS game_collection (
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
CREATE TABLE IF NOT EXISTS game_match (
  title TEXT NOT NULL,
  year INTEGER NOT NULL,
  ext_id TEXT,                          -- null when none was found or the answer was ambiguous
  candidates TEXT,                      -- JSON: the first few hits, for the owner to choose from
  tried_at INTEGER NOT NULL,
  PRIMARY KEY (title, year)
);

-- One game, as the register has it.
CREATE TABLE IF NOT EXISTS game_item (
  ext_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  creator TEXT,                         -- the developer
  year INTEGER,
  summary TEXT,                         -- plain text
  cover TEXT,                           -- an address on the register's own image host, http or https
  url TEXT,                             -- its page in the register
  fetched_at INTEGER NOT NULL,
  banner TEXT                           -- a wide picture for behind the work's page: an address on the register's own image host (a game's screenshot, a book's author), none where it has none
);

-- The logo of a developer, as the register has it (`games-sync igdb`): one row for each developer name a game names, so a
-- name the register has no logo for is not asked again. `logo` is an address on the register's own image host.
CREATE TABLE IF NOT EXISTS game_company (
  name TEXT PRIMARY KEY,                -- as `game_item.creator` writes it, one developer
  logo TEXT,                            -- none when the register has no logo for the company
  fetched_at INTEGER NOT NULL
);

-- What IGDB says about a game beyond its facts in `game_item` (`games-sync igdb`, `igdb --everything` fetches it again):
-- the platforms it came out on, its modes, themes, player perspectives and the series it belongs to, one row each.
CREATE TABLE IF NOT EXISTS game_facet (
  ext_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('platform', 'mode', 'theme', 'perspective', 'series')),
  name TEXT NOT NULL,
  PRIMARY KEY (ext_id, kind, name)
);

-- How long a game takes by IGDB's players, in hours: quickly through the story, at an ordinary pace, everything. A game
-- the register has no times for still gets a row (all NULL), so it is not asked again.
CREATE TABLE IF NOT EXISTS game_time_to_beat (
  ext_id TEXT PRIMARY KEY,
  hastily_hours REAL,
  normally_hours REAL,
  completely_hours REAL,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS game_genre (
  ext_id TEXT NOT NULL,
  genre TEXT NOT NULL,
  PRIMARY KEY (ext_id, genre)
);

-- One achievement of one game, from the service that counts it (`games-sync steam-achievements`, `retroachievements`, `xbox`).
-- Locked ones are rows too, so a game's total is known; `unlocked_at` is none until the owner has it.
CREATE TABLE IF NOT EXISTS game_achievement (
  source TEXT NOT NULL,                 -- `steam`, `ra`, `xbox` or `pokemongo`
  game TEXT NOT NULL,                   -- the service's number for the game, as in `game_entry.source` after the colon
  id TEXT NOT NULL,                     -- the service's number or name for the achievement
  title TEXT NOT NULL,
  description TEXT,
  icon TEXT,                            -- an address on the service's own image host, http or https
  points INTEGER,                       -- RetroAchievements' points or Xbox's gamerscore; none for Steam
  rarity REAL,                          -- percent of players who have it, or none
  unlocked_at INTEGER,                  -- seconds since the epoch, or none while locked; 0 is unlocked on a day nobody knows
  progress REAL,                        -- how far it is: the value counted towards `target`, or none where the service gives none
  target REAL,                          -- what the next step asks (the goal, or the next tier's), or none
  tier INTEGER,                         -- of a medal with tiers (1 bronze to 4 platinum): the one reached; none for an achievement without
  tiers INTEGER,                        -- how many tiers it has
  PRIMARY KEY (source, game, id)
);

-- Where the player stands at a service, as a number: a level, a score, a rank. One row for each day it was read, so how it
-- grew can be told; the newest day is where the player stands now. `max` is the highest it can be, where there is one.
CREATE TABLE IF NOT EXISTS game_profile (
  source TEXT NOT NULL,                 -- `steam`, `ra`, `xbox` or `pokemongo`
  key TEXT NOT NULL,                    -- `level`, `xp`, `points`, `gamerscore`
  day TEXT NOT NULL,                    -- YYYY-MM-DD it was read, in the owner's time
  label TEXT NOT NULL,                  -- what the page calls it: «Nivå», «Gamerscore»
  value REAL NOT NULL,
  max REAL,
  PRIMARY KEY (source, key, day)
);

CREATE INDEX IF NOT EXISTS idx_game_achievement_game ON game_achievement (source, game);

-- One ROM in RomM (`games-sync romm`), replaced whole at each run. `igdb_id` is the register's number for the game, so a ROM
-- is matched to a work by `game_item.ext_id`. Only `romm_id` is ever published, to build the link to the ROM.
CREATE TABLE IF NOT EXISTS game_romm (
  romm_id INTEGER PRIMARY KEY,          -- RomM's number for the ROM
  platform TEXT NOT NULL,               -- RomM's platform slug: gba, snes
  title TEXT NOT NULL,
  igdb_id TEXT,
  ra_id TEXT,                           -- RetroAchievements' number for the game, as in `game_entry.source` after `ra:`
  fetched_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_game_romm_igdb ON game_romm (igdb_id);
