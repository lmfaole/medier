-- podcasts: everything about podcasts, in its own file (`.data/podcasts.db`), apart from
-- `db/schema.sql` and `.data/data.db`: the plays Spotify's "Extended streaming history" has
-- (`podcast_plays`, whose importer was removed on 2026-10-15), the plays ListenBrainz and
-- Last.fm scrobbled (`podcast_listens`, moved out of `listens` by music-sync's
-- `split-podcasts`), the shows that tell the two apart (`podcast_shows`) and the episodes of a
-- podcast written by hand (`podcast_episode`). Idempotent, applied on every run.

-- One row per play of an episode, as the export has it: every play, skips
-- included, so whoever reads it picks the threshold. `started_at` is unix
-- seconds when the play began (the export stamps the end).
CREATE TABLE IF NOT EXISTS podcast_plays (
  started_at INTEGER NOT NULL,
  show_name TEXT NOT NULL,
  episode_name TEXT NOT NULL,
  episode_uri TEXT NOT NULL,            -- spotify:episode:…
  ms_played INTEGER NOT NULL,
  platform TEXT,
  reason_end TEXT,                      -- trackdone, endplay, fwdbtn, …
  PRIMARY KEY (started_at, episode_uri)
);

CREATE INDEX IF NOT EXISTS idx_podcast_plays_show ON podcast_plays (show_name);
CREATE INDEX IF NOT EXISTS idx_podcast_plays_time ON podcast_plays (started_at);
-- The scrobble-against-Spotify check of `PODCAST_PLAYS_SQL` looks a play up by its episode name and time.
CREATE INDEX IF NOT EXISTS idx_podcast_plays_episode ON podcast_plays (episode_name, started_at);

-- Which export folders have been imported, and how many plays each added.
CREATE TABLE IF NOT EXISTS import_log (
  source TEXT PRIMARY KEY,
  imported_at INTEGER NOT NULL,
  plays_added INTEGER NOT NULL
);

-- The shows, and other spoken-word sources, whose plays are not music: `split-podcasts` moves a
-- listen out of `listens` when its artist is a row here, or when it has no album and no
-- MusicBrainz recording and lasts ten minutes or more (a news clip scrobbled with its headline as
-- the artist). `artist_name` is how ListenBrainz names the show. Changed by hand:
-- `npm run data:push -- --db podcasts <file>`.
CREATE TABLE IF NOT EXISTS podcast_shows (
  artist_name TEXT PRIMARY KEY
);

-- A play of a podcast that ListenBrainz or Last.fm scrobbled, as it was in `listens`.
CREATE TABLE IF NOT EXISTS podcast_listens (
  listened_at INTEGER NOT NULL,
  track_name TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  release_name TEXT,
  recording_mbid TEXT,
  artist_mbid TEXT,
  release_mbid TEXT,
  duration_ms INTEGER,
  PRIMARY KEY (listened_at, track_name, artist_name)
);

CREATE INDEX IF NOT EXISTS idx_podcast_listens_time ON podcast_listens (listened_at);

-- Podcast episode, written by hand.
CREATE TABLE IF NOT EXISTS podcast_episode (
  id INTEGER PRIMARY KEY,
  sesong INTEGER,                       -- Season
  episode INTEGER,
  tittel TEXT NOT NULL,                 -- Title
  dato TEXT NOT NULL,                   -- Date
  bilde TEXT NOT NULL,                  -- Artwork path
  bildestatus TEXT NOT NULL,
  bildekilde TEXT NOT NULL,
  lenke TEXT,
  notat TEXT,
  audio_url TEXT,
  audio_bytes INTEGER,
  audio_crc32 TEXT,
  omslag TEXT
);

-- What the podcasts are, from the shows' own feeds and Apple's directory (music-sync's `podcast-feeds`; the
-- originals are under `.data/raw/podcast-feeds/<date>/`). `show_name` is the name the plays use.

-- One row per show that was found: what its feed says about it. `itunes_country` is the Apple storefront the
-- show was found in (NOR, USA), not where it is made: that is `podcast_show_country`.
CREATE TABLE IF NOT EXISTS podcast_show_info (
  show_name TEXT PRIMARY KEY,
  itunes_id INTEGER,
  feed_url TEXT,
  title TEXT NOT NULL,
  author TEXT,
  owner_name TEXT,
  language TEXT,
  itunes_country TEXT,
  genre TEXT,
  description TEXT,                     -- plain text, at most 2000 characters
  website TEXT,
  image_url TEXT,
  apple_url TEXT,
  fetched_at INTEGER NOT NULL
);

-- Every show looked for, found or not, so a show Apple does not have is not asked for again each night.
CREATE TABLE IF NOT EXISTS podcast_lookup (
  show_name TEXT PRIMARY KEY,
  tried_at INTEGER NOT NULL,
  found INTEGER NOT NULL
);

-- The episodes of a show's feed, as the feed has them (a feed keeps only its newest ones).
CREATE TABLE IF NOT EXISTS podcast_feed_episode (
  show_name TEXT NOT NULL,
  guid TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,                     -- plain text, at most 2000 characters
  published_at INTEGER,                 -- unix seconds
  duration_s INTEGER,
  link TEXT,
  season INTEGER,
  episode INTEGER,
  PRIMARY KEY (show_name, guid)
);

CREATE INDEX IF NOT EXISTS idx_podcast_feed_episode_title ON podcast_feed_episode (show_name, title);

-- The people a feed names (`podcast:person`): of the show when `episode_guid` is empty, else of that episode.
CREATE TABLE IF NOT EXISTS podcast_person (
  show_name TEXT NOT NULL,
  episode_guid TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,                   -- host, guest, … or empty
  href TEXT,
  PRIMARY KEY (show_name, episode_guid, name, role)
);

-- Where a show is made, written by hand (`db/podcast-countries.sql`): no feed says it reliably.
CREATE TABLE IF NOT EXISTS podcast_show_country (
  show_name TEXT PRIMARY KEY,
  country TEXT NOT NULL,
  note TEXT
);

-- Which feed is a show's, decided by hand (`db/podcast-feeds.sql`): where Apple's directory has several shows of one
-- name, or none under it. The `podcast-feeds` job takes this feed and asks no directory. An empty `feed_url` says the
-- show has no feed worth using, and the job leaves it alone.
CREATE TABLE IF NOT EXISTS podcast_feed_choice (
  show_name TEXT PRIMARY KEY,
  feed_url TEXT NOT NULL,
  note TEXT
);

-- The Podcasts app as Apple's data export remembers it (music-sync `import-apple-podcasts`, original under
-- .data/raw/apple-media/). `apple_podcast_feed` is every feed the owner followed or played, by feed address; `apple_podcast_state`
-- is one row per episode the app has a state for (the episode's GUID, no title: the title is in the feed).
CREATE TABLE IF NOT EXISTS apple_podcast_feed (
  feed_url TEXT PRIMARY KEY,
  title TEXT, -- empty for a feed played without following
  subscribed INTEGER NOT NULL,
  added_at INTEGER,
  touched_at INTEGER,
  played_at INTEGER,
  store_id INTEGER
);
CREATE TABLE IF NOT EXISTS apple_podcast_state (
  feed_url TEXT NOT NULL,
  episode_id TEXT NOT NULL,
  played_at INTEGER, -- last played, unix seconds
  position REAL,
  play_count INTEGER,
  played INTEGER, -- 1 yes, 0 no, NULL not said
  PRIMARY KEY (feed_url, episode_id)
);
CREATE INDEX IF NOT EXISTS idx_apple_podcast_state_time ON apple_podcast_state (played_at);
