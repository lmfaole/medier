-- Schema of `.data/music.db`: ListenBrainz listens and what is computed from them (`apps/music/sync-rust`). Every statement is idempotent: the tools apply it on every
-- run (`include_str!`), `npm run snapshot` applies it, and the tests build their SQLite from it.
-- A changed or dropped column is a numbered migration in `db/migrations/music/` (`docs/DATA.md`).

-- =============================================================================
-- music: ListenBrainz listens and the summaries computed from them. Written by `apps/music/sync-rust` only.
-- =============================================================================
-- `listens` is the raw import from ListenBrainz. Everything else is
-- recomputed by sync-rust/ on every sync, so it is safe to delete and
-- rebuild; only `listens` and `sync_state` hold anything irreplaceable.

CREATE TABLE IF NOT EXISTS listens (
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

CREATE INDEX IF NOT EXISTS idx_listens_artist ON listens (artist_name);
CREATE INDEX IF NOT EXISTS idx_listens_time ON listens (listened_at);

-- Single-row bookmark: where the last sync left off.
CREATE TABLE IF NOT EXISTS sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_listened_at INTEGER NOT NULL DEFAULT 0,
  last_synced_at INTEGER
);
INSERT OR IGNORE INTO sync_state (id, last_listened_at) VALUES (1, 0);

-- Single-row cursor of the metadata job: every listen up to this rowid has had
-- its recording asked for. Listens are only appended, so the job looks at the
-- ones after it and never rescans the history. Set to 0 to refetch everything
-- after clearing `recording_metadata`.
CREATE TABLE IF NOT EXISTS enrich_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_listen_rowid INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO enrich_state (id, last_listen_rowid) VALUES (1, 0);

-- The recordings the owner has loved on Last.fm (score 1; -1 is allowed, Last.fm has no hate). The loves live
-- there and can be taken back, so each `feedback` run replaces the whole table with what
-- Last.fm says now. Names are as Last.fm spells them.
CREATE TABLE IF NOT EXISTS recording_feedback (
  recording_mbid TEXT PRIMARY KEY,
  score INTEGER NOT NULL CHECK (score IN (-1, 1)),
  created_at INTEGER NOT NULL, -- unix seconds, when the feedback was given
  track_name TEXT,
  artist_name TEXT,
  release_name TEXT
);

-- The tracks the owner has saved on Spotify ("Liked Songs"). They live there and can be removed,
-- so each `spotify-likes` run replaces the whole table with what Spotify says now.
CREATE TABLE IF NOT EXISTS spotify_saved (
  spotify_id TEXT PRIMARY KEY,
  isrc TEXT,
  track_name TEXT NOT NULL,
  artist_name TEXT NOT NULL, -- every credited artist in order, joined with char(31)
  album_name TEXT,
  added_at INTEGER NOT NULL -- unix seconds
);

-- The rest of the owner's Spotify library: saved albums, own and collaborative playlists with their tracks, and
-- followed artists. They live there and can be removed, so each `spotify-library` run replaces all four tables with what
-- Spotify says now. A track is kept by its position in the playlist; local files and episodes have no track id and are left out.
CREATE TABLE IF NOT EXISTS spotify_album_saved (
  spotify_id TEXT PRIMARY KEY,
  upc TEXT,
  album_name TEXT NOT NULL,
  artist_name TEXT NOT NULL, -- every credited artist in order, joined with char(31)
  release_date TEXT,
  total_tracks INTEGER,
  label TEXT,
  added_at INTEGER NOT NULL -- unix seconds
);
CREATE TABLE IF NOT EXISTS spotify_playlist (
  playlist_id TEXT PRIMARY KEY,
  playlist_name TEXT NOT NULL,
  description TEXT,
  owner_id TEXT NOT NULL,
  is_public INTEGER, -- NULL when Spotify does not say
  collaborative INTEGER NOT NULL,
  snapshot_id TEXT NOT NULL,
  tracks_kept INTEGER NOT NULL -- 0 for a list of someone else's, whose tracks are not read
);
CREATE TABLE IF NOT EXISTS spotify_playlist_track (
  playlist_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  spotify_id TEXT NOT NULL,
  isrc TEXT,
  track_name TEXT NOT NULL,
  artist_name TEXT NOT NULL, -- every credited artist in order, joined with char(31)
  added_at INTEGER,
  PRIMARY KEY (playlist_id, position)
);
CREATE TABLE IF NOT EXISTS spotify_followed_artist (
  spotify_id TEXT PRIMARY KEY,
  artist_name TEXT NOT NULL
);

-- What Spotify says was played, with where it was played from (`context`: a playlist, album, artist or nothing).
-- Spotify keeps only the last 50 plays, so each `spotify-recent` run adds what is new and nothing is replaced.
CREATE TABLE IF NOT EXISTS spotify_play (
  played_at INTEGER NOT NULL, -- unix seconds
  spotify_id TEXT NOT NULL,
  track_name TEXT NOT NULL,
  artist_name TEXT NOT NULL, -- every credited artist in order, joined with char(31)
  context_type TEXT, -- playlist, album, artist, show; NULL for a play with no context
  context_uri TEXT,
  PRIMARY KEY (played_at, spotify_id)
);

-- Apple Music's own data export (`import-apple`, originals under .data/raw/apple-media/). `apple_track` is its library
-- (song and music-video metadata by library id); `apple_play` every finished play with the exact start, the device and where it
-- was played from, skips included (the export's IP address and position columns are never read). `listens` gets only the plays
-- of 30 s or more that no scrobble has. Keys make a second import of the same export change nothing.
CREATE TABLE IF NOT EXISTS apple_track (
  track_id INTEGER PRIMARY KEY, -- the library id every Apple file uses
  catalog_id INTEGER, -- the Apple Music catalogue id
  content_type TEXT, -- Song or Music Video
  title TEXT,
  artist TEXT,
  album TEXT,
  album_artist TEXT,
  genre TEXT,
  year INTEGER,
  track_number INTEGER,
  disc_number INTEGER,
  duration_ms INTEGER,
  release_date TEXT,
  added_at INTEGER, -- unix seconds
  play_count INTEGER,
  skip_count INTEGER,
  favorite INTEGER -- 1 when the library marks the track as a favourite
);
CREATE INDEX IF NOT EXISTS idx_apple_track_title ON apple_track (title, album);

CREATE TABLE IF NOT EXISTS apple_play (
  event_id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL, -- unix seconds
  ended_at INTEGER,
  song_name TEXT NOT NULL,
  album_name TEXT,
  artist_name TEXT, -- from apple_track when one library entry matches the song and album, else NULL
  track_id INTEGER,
  media_type TEXT, -- AUDIO or VIDEO
  play_ms INTEGER,
  media_ms INTEGER,
  end_reason TEXT,
  container_type TEXT, -- ALBUM, PLAYLIST, RADIO, ...
  container_name TEXT,
  feature TEXT, -- the screen it was started from
  device TEXT,
  utc_offset INTEGER,
  shuffle TEXT,
  listen_added INTEGER NOT NULL DEFAULT 0 -- 1 when this play put a row into listens
);
CREATE INDEX IF NOT EXISTS idx_apple_play_time ON apple_play (started_at);

CREATE TABLE IF NOT EXISTS apple_favorite (
  kind TEXT NOT NULL, -- Song, Album, Artist, Playlist
  item_ref TEXT NOT NULL, -- a library or catalogue id, or a playlist id such as pl.…
  description TEXT,
  preference TEXT NOT NULL, -- LIKE, DISLIKE, NEUTRAL
  modified_at INTEGER,
  PRIMARY KEY (kind, item_ref)
);

CREATE TABLE IF NOT EXISTS apple_playlist (
  playlist_id INTEGER PRIMARY KEY,
  kind TEXT, -- Playlist, Subscribed Playlist, Folder, Smart Playlist, Genius Mix, ...
  title TEXT,
  description TEXT,
  parent_id INTEGER,
  added_at INTEGER
);
CREATE TABLE IF NOT EXISTS apple_playlist_track (
  playlist_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  track_id INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, position)
);

-- Every track loved on Last.fm, with or without a MusicBrainz id (`recording_feedback` has only those with one).
-- Replaced by each `feedback` run; the likes sync compares it with `spotify_saved`.
CREATE TABLE IF NOT EXISTS lastfm_loved (
  artist_name TEXT NOT NULL,
  track_name TEXT NOT NULL,
  loved_at INTEGER NOT NULL,
  PRIMARY KEY (artist_name, track_name)
);

-- What the likes sync keeps by hand or by itself. `song_key` is `song_key.rs`'s key. The sync only adds likes:
-- `like_pushed` and `like_unmatched` stop a song from being tried again in that `target` direction (spotify or lastfm),
-- `like_ignore` keeps it out both ways.
CREATE TABLE IF NOT EXISTS like_ignore (
  song_key TEXT PRIMARY KEY,
  artist_name TEXT NOT NULL,
  track_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS like_pushed (
  song_key TEXT NOT NULL,
  target TEXT NOT NULL CHECK (target IN ('spotify', 'lastfm')),
  pushed_at INTEGER NOT NULL,
  PRIMARY KEY (song_key, target)
);
CREATE TABLE IF NOT EXISTS like_unmatched (
  song_key TEXT NOT NULL,
  target TEXT NOT NULL CHECK (target IN ('spotify', 'lastfm')),
  tried_at INTEGER NOT NULL,
  PRIMARY KEY (song_key, target)
);

-- Which (artist, track) pairs `resolve` has tried to give a MusicBrainz id, by which
-- source, so a pair that matched nothing is not asked for again on every run.
-- `matched` wrote the ids onto the listens, `rejected` found candidates none of which
-- passed the artist and title rule, `missing` found no candidate at all.
-- An album asked of MusicBrainz by name (`resolve-albums`): the outcome, so a miss is not asked again for a quarter of a year.
CREATE TABLE IF NOT EXISTS resolve_album_attempts (
  artist_name TEXT NOT NULL,
  release_name TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('matched', 'partial', 'missing')),
  tried_at INTEGER NOT NULL,
  PRIMARY KEY (artist_name, release_name)
);

CREATE TABLE IF NOT EXISTS resolve_attempts (
  artist_name TEXT NOT NULL,
  track_name TEXT NOT NULL,
  source TEXT NOT NULL, -- listenbrainz or musicbrainz
  outcome TEXT NOT NULL CHECK (outcome IN ('matched', 'rejected', 'missing')),
  tried_at INTEGER NOT NULL,
  PRIMARY KEY (artist_name, track_name, source)
);

-- One summary row per period: "all", or a four-digit year.
CREATE TABLE IF NOT EXISTS summary_periods (
  period_key TEXT PRIMARY KEY,
  total_listens INTEGER NOT NULL,
  total_minutes INTEGER NOT NULL,
  unique_artists INTEGER NOT NULL,
  unique_tracks INTEGER NOT NULL,
  top_artist_name TEXT,
  top_track_name TEXT,
  top_track_artist TEXT,
  longest_streak_days INTEGER NOT NULL DEFAULT 0,
  current_streak_days INTEGER NOT NULL DEFAULT 0,
  computed_at INTEGER NOT NULL
);

-- Top 10 per period and category (artist, track, album).
CREATE TABLE IF NOT EXISTS top_items (
  period_key TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('artist', 'track', 'album')),
  rank INTEGER NOT NULL,
  name TEXT NOT NULL,
  secondary_name TEXT,
  play_count INTEGER NOT NULL,
  minutes INTEGER NOT NULL,
  PRIMARY KEY (period_key, category, rank)
);

-- Metadata from ListenBrainz' /1/metadata/recording, one row per recording
-- a listen is mapped to, fetched once by sync-rust/src/enrich.rs. A
-- recording ListenBrainz knows nothing about still gets a row (all NULL) so
-- it is not asked for again on every sync. Safe to delete, since it is
-- refetched, but a full refetch is rate-limited and spans several syncs.
CREATE TABLE IF NOT EXISTS recording_metadata (
  recording_mbid TEXT PRIMARY KEY,
  release_year INTEGER,
  release_date TEXT,                    -- YYYY, YYYY-MM or YYYY-MM-DD; NULL on rows fetched before it was kept
  length_ms INTEGER,
  artist_mbid TEXT,
  artist_area TEXT,
  artist_type TEXT,
  artist_begin_year INTEGER,
  release_group_mbid TEXT,
  caa_release_mbid TEXT,
  caa_id INTEGER,
  fetched_at INTEGER NOT NULL
);

-- What MusicBrainz says beyond ListenBrainz' metadata, fetched a few hundred at a time, the most played first
-- (`music-sync enrich-extra`; the answers are landed under `.data/raw/musicbrainz/<date>/`). A thing the register
-- has nothing on still gets a row (all NULL), so it is not asked again. Safe to delete: it is fetched again.
-- The kind of release a recording is on: `Album`, `Single`, `EP`, and the secondary ones (`Live`, `Compilation`, ...).
CREATE TABLE IF NOT EXISTS release_group_info (
  release_group_mbid TEXT PRIMARY KEY,
  primary_type TEXT,
  secondary_types TEXT,                 -- comma-separated, none when there are none
  fetched_at INTEGER NOT NULL,
  first_release_date TEXT,              -- YYYY, YYYY-MM or YYYY-MM-DD, from `release-dates`
  dated_at INTEGER                      -- when `release-dates` asked; NULL until then
);

-- What kind of release MusicBrainz says an album an artist was heard on is, asked by the artist's name and the album's (`music-sync album-types`):
-- `recording_metadata.release_group_mbid` is the recording's own release group, which for a single is often the album it is on, so it cannot say
-- whether the played release is an album. A row with no type means MusicBrainz had no release group of that name and artist; it is not asked again.
CREATE TABLE IF NOT EXISTS album_type (
  artist_name TEXT NOT NULL,
  release_name TEXT NOT NULL,
  primary_type TEXT,
  secondary_types TEXT,                 -- comma-separated, none when there are none
  release_group_mbid TEXT,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (artist_name, release_name)
);

-- The front picture the Cover Art Archive holds for a release or release group ListenBrainz' metadata gave none for
-- (`music-sync release-covers`). A group's picture belongs to one of its releases, so the cover is `caa_release_mbid/caa_id`.
-- No image when the archive has none; the row marks it as asked. Safe to delete: it is fetched again.
CREATE TABLE IF NOT EXISTS release_cover (
  source_mbid TEXT PRIMARY KEY,         -- the release or release group that was asked about
  caa_release_mbid TEXT,
  caa_id INTEGER,
  fetched_at INTEGER NOT NULL
);

-- The label that put a release out (the first one MusicBrainz names), for the releases that have a cover.
CREATE TABLE IF NOT EXISTS release_label (
  release_mbid TEXT PRIMARY KEY,
  label TEXT,
  fetched_at INTEGER NOT NULL
);

-- When an artist was active, and a picture of them from Wikimedia Commons by way of the artist's Wikidata entry.
CREATE TABLE IF NOT EXISTS artist_info (
  artist_mbid TEXT PRIMARY KEY,
  begin_year INTEGER,
  end_year INTEGER,
  ended INTEGER NOT NULL DEFAULT 0,
  wikidata_id TEXT,
  image TEXT,                           -- an address on commons.wikimedia.org, https
  fetched_at INTEGER NOT NULL
);

-- The picture Deezer has of an artist, asked for by name and kept only when Deezer's artist is named exactly the same.
-- An artist Deezer does not know has a row with no image, so it is not asked again.
CREATE TABLE IF NOT EXISTS artist_deezer (
  artist_mbid TEXT PRIMARY KEY,
  deezer_id INTEGER,
  image TEXT,                           -- an address on cdn-images.dzcdn.net, https
  fetched_at INTEGER NOT NULL
);

-- The picture Spotify has of an artist, asked for by name and kept only when Spotify's artist is named exactly the same.
-- An artist Spotify does not know has a row with no image, so it is not asked again.
CREATE TABLE IF NOT EXISTS artist_spotify (
  artist_mbid TEXT PRIMARY KEY,
  spotify_id TEXT,
  image TEXT,                           -- an address on i.scdn.co, https
  fetched_at INTEGER NOT NULL
);

-- The cover Spotify has of the album a Cover Art Archive release belongs to, asked for by album name and artist and kept only
-- when Spotify's album is named exactly the same. An album Spotify does not know has a row with no image, so it is not asked again.
CREATE TABLE IF NOT EXISTS album_spotify (
  release_mbid TEXT PRIMARY KEY,        -- the release a cover path is made of (`recording_metadata.caa_release_mbid`)
  spotify_id TEXT,
  image TEXT,                           -- an address on i.scdn.co, https
  fetched_at INTEGER NOT NULL
);

-- Up to three MusicBrainz genres per recording, taken from the most specific
-- level that has any: the recording's own tags, then its release group's,
-- then its artist's. Only tags that are official MusicBrainz genres count.
CREATE TABLE IF NOT EXISTS recording_genres (
  recording_mbid TEXT NOT NULL,
  genre TEXT NOT NULL,
  PRIMARY KEY (recording_mbid, genre)
);

-- Distributions that feed the dashboard's charts, per period, recomputed on
-- every sync like the tables above. `dimension` says what `label` is:
--   genre   a MusicBrainz genre, top 15 (a listen counts once per genre)
--   decade  the decade a recording was first released, "1990s"
--   area    where the recording's first credited artist is from, top 15
--   month   "YYYY-MM", every month with a listen
CREATE TABLE IF NOT EXISTS breakdowns (
  period_key TEXT NOT NULL,
  dimension TEXT NOT NULL CHECK (dimension IN ('genre', 'decade', 'area', 'month')),
  label TEXT NOT NULL,
  play_count INTEGER NOT NULL,
  minutes INTEGER NOT NULL,
  PRIMARY KEY (period_key, dimension, label)
);

-- How many of a period's listens have metadata at all, so the charts can
-- say what share of the listening they actually describe.
CREATE TABLE IF NOT EXISTS metadata_coverage (
  period_key TEXT PRIMARY KEY,
  total_listens INTEGER NOT NULL,
  listens_with_metadata INTEGER NOT NULL
);

-- The album cover shown beside each `top_items` row, as
-- "<caa_release_mbid>/<caa_id>" for a Cover Art Archive URL. Kept apart from
-- `top_items` because a new column there would need an ALTER TABLE, which
-- cannot be made idempotent. Rows without any known cover are left out.
CREATE TABLE IF NOT EXISTS top_item_covers (
  period_key TEXT NOT NULL,
  category TEXT NOT NULL,
  rank INTEGER NOT NULL,
  cover TEXT NOT NULL,
  PRIMARY KEY (period_key, category, rank)
);

-- Fun facts about the whole history for the front page, one JSON object per
-- fact, recomputed by sync-rust/src/facts.rs on every sync. Which fields a
-- fact has depends on its key; the frontend owns the sentence for each.
CREATE TABLE IF NOT EXISTS fun_facts (
  fact_key TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  computed_at INTEGER NOT NULL
);

-- Plays per calendar day (UTC), once for the whole history rather than per
-- period: a year is a range of `day`. Feeds the all-time totals' streaks.
CREATE TABLE IF NOT EXISTS daily_plays (
  day TEXT PRIMARY KEY,
  play_count INTEGER NOT NULL
);

-- Time listened per calendar day (UTC), in milliseconds so a sum over days
-- is exact: the all-time minutes are their total / 60000, the same as
-- summing the listens. Kept apart from `daily_plays` because a new column
-- there would need an ALTER TABLE, which cannot be made idempotent. A day
-- without a row has not been backfilled yet: `daily-plays all` fills them.
CREATE TABLE IF NOT EXISTS daily_listening_time (
  day TEXT PRIMARY KEY,
  listened_ms INTEGER NOT NULL
);


-- "On this day": per calendar day (`MM-DD`, UTC) and year with plays, how much
-- was heard and the top tracks (a JSON array of `{track, artist, plays, cover}`).
-- Written by sync-rust/src/memories.rs; derived and safe to delete.
CREATE TABLE IF NOT EXISTS day_memories (
  month_day TEXT NOT NULL,
  year INTEGER NOT NULL,
  play_count INTEGER NOT NULL,
  minutes INTEGER NOT NULL,
  top_artist TEXT NOT NULL,
  top_tracks TEXT NOT NULL,
  PRIMARY KEY (month_day, year)
);


-- A month in review (`YYYY-MM`, UTC): plays, minutes and JSON lists of the top
-- artists and tracks, the artists first heard that month and those whose last
-- play ever was a while before the newest data. Written by
-- sync-rust/src/capsules.rs; derived and safe to delete.
CREATE TABLE IF NOT EXISTS month_capsules (
  month TEXT PRIMARY KEY,
  play_count INTEGER NOT NULL,
  minutes INTEGER NOT NULL,
  top_artists TEXT NOT NULL,
  top_tracks TEXT NOT NULL,
  new_artists TEXT NOT NULL,
  gone_quiet TEXT NOT NULL
);

-- The pages behind the sheets: one row for each of the most played artists,
-- albums and songs (`kind`), with its address (`slug`), what the index lists
-- and a JSON `detail` whose shape depends on the kind. Written by
-- sync-rust/src/entities.rs; derived and safe to delete. It replaces
-- `artist_profiles`, dropped here so a database that has it loses it.
CREATE TABLE IF NOT EXISTS entity_pages (
  kind TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  cover TEXT,
  play_count INTEGER NOT NULL,
  detail TEXT NOT NULL,
  PRIMARY KEY (kind, slug)
);
DROP TABLE IF EXISTS artist_profiles;

-- The which-year game's `quiz_tracks` (derived) is gone with the game; dropped here so a database that has it loses it.
DROP TABLE IF EXISTS quiz_tracks;

-- What the owner says they have heard that is no scrobble: an artist, an album or a song, added by hand or with
-- `npm run seen` to fill in the taste from before the scrobbles and from where nothing scrobbles. `year` is as given,
-- else the first release MusicBrainz knows; `genres` is up to three of its tags as a JSON list (`music-sync
-- enrich-heard`). A row is never changed by a scrobble.
CREATE TABLE IF NOT EXISTS music_heard (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('artist', 'album', 'song')),
  artist TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',        -- the album or the song; empty for an artist
  year INTEGER,
  heard_on TEXT,                         -- YYYY-MM-DD, or none when the day is not known
  mbid TEXT,                             -- MusicBrainz's number for the artist, release group or recording
  genres TEXT,                           -- JSON list, up to three
  looked_up_at INTEGER,                  -- unix seconds; none until MusicBrainz was asked
  UNIQUE (kind, artist, title)
);

-- The concerts the owner has been to, one line each in `.data/music-concerts.csv` (`mail-concerts` writes it from the ticket
-- receipts). `music-sync import-concerts` makes this table exactly the file's lines. A venue is a place, so this table is in
-- no snapshot until the owner decides that it may be.
CREATE TABLE IF NOT EXISTS music_concert (
  id INTEGER PRIMARY KEY,
  watched_on TEXT,                      -- YYYY-MM-DD, or none when the day is not known
  title TEXT NOT NULL,                  -- the event as the ticket seller names it
  place TEXT                            -- the venue
);

-- The artists the owner saw at a concert, written by hand in `.data/music-concert-acts.csv` (`watched_on,title,artist,billing`):
-- a line of `music_concert` (the day and the title) has none, one or many, so a festival day or a night with a support act
-- is one concert with several artists. `billing` is `headliner`, `support` or empty. `music-sync import-concerts` makes this
-- table exactly the file's lines. Like `music_concert`, it is in no snapshot.
CREATE TABLE IF NOT EXISTS music_concert_act (
  id INTEGER PRIMARY KEY,
  watched_on TEXT NOT NULL,             -- YYYY-MM-DD, the day of the concert's line
  title TEXT NOT NULL,                  -- the concert's title, as its line writes it
  artist TEXT NOT NULL,
  billing TEXT CHECK (billing IN ('headliner', 'support'))
);

-- The Immich album of a concert of the log that has no calendar event (`npm run concert:album` makes it and writes it down in
-- `.data/music-concert-albums.csv`, `watched_on,title,album_id`): matched to a concert by day and title. `music-sync import-concerts`
-- makes this table exactly the file's lines. Only the id is kept; the link is built when the page is shown.
CREATE TABLE IF NOT EXISTS music_concert_album (
  watched_on TEXT NOT NULL,             -- YYYY-MM-DD
  title TEXT NOT NULL,                  -- the concert's title, as its line writes it
  album_id TEXT NOT NULL,
  PRIMARY KEY (watched_on, title)
);

-- The setlist of an artist at a concert, as setlist.fm has it (`music-sync setlist-songs`): a row a song, in the order played, for the
-- concert's day and title (a festival day has one setlist for each artist written for it). `url` is the setlist's page on the site, which
-- the page links to. `encore` is 0 for the main set and the number of the encore after it. `cover` names the artist a cover is of.
CREATE TABLE IF NOT EXISTS music_concert_setlist (
  watched_on TEXT NOT NULL,             -- YYYY-MM-DD
  title TEXT NOT NULL,                  -- the concert's title, as its line writes it
  artist TEXT NOT NULL,
  url TEXT NOT NULL,
  position INTEGER NOT NULL,
  encore INTEGER NOT NULL DEFAULT 0,
  song TEXT NOT NULL,
  cover TEXT,
  PRIMARY KEY (watched_on, title, artist, position)
);

-- The colour of an album cover (`npm run cover:colors` reads the covers and writes `.data/music-cover-colors.csv`, `cover,color`), keyed as the
-- pages' data names a cover, `<release>/<image>`: the charts of an album, a song and an artist take their colours from it.
-- `music-sync import-cover-colors` makes this table exactly the file's lines.
CREATE TABLE IF NOT EXISTS music_cover_color (
  cover TEXT PRIMARY KEY,
  color TEXT NOT NULL                   -- #rrggbb
);

-- Where a venue is, written in `.data/music-venues.csv` (`venue,lat,lon`; `npm run venue:maps` looks a venue up and the owner corrects a
-- line by hand): matched to a concert by the venue's text. `music-sync import-concerts` makes this table exactly the file's lines. The
-- map of a venue is a picture kept beside the concert photos; a place is in no snapshot.
CREATE TABLE IF NOT EXISTS music_venue (
  venue TEXT PRIMARY KEY,
  lat REAL NOT NULL,
  lon REAL NOT NULL
);

-- The concerts of the owner's `Konserter` calendar, upcoming and past: `music-sync import-concerts-calendar` makes this table exactly
-- the calendar's events (`mail-concerts` puts one there for each Ticketmaster receipt). `album_id` is the Immich album of the
-- concert's photos, which the Nextcloud repository's `event-albums` makes and writes down; only the id is kept, the link is built
-- when the page is shown. Like `music_concert`, a venue is a place, so this table is in no snapshot.
CREATE TABLE IF NOT EXISTS music_concert_event (
  uid TEXT PRIMARY KEY,
  on_date TEXT NOT NULL,                -- YYYY-MM-DD
  at_time TEXT,                         -- HH:MM, or none for a whole day
  title TEXT NOT NULL,                  -- the event as the ticket seller names it
  venue TEXT,
  album_id TEXT                         -- the Immich album, when `event-albums` has made one
);

-- The photos and videos of the Immich album of a concert, as small pictures kept in `.data/concert-photos/`: `music-sync concert-photos`
-- makes this table exactly the favourites of each album it can ask for (first) and others spread over the evening. A video is kept as
-- the picture Immich makes of it, with `is_video`. The pictures are photos of people and places, so they are shown only to the owner,
-- behind the login, and are in no snapshot. It replaces `music_concert_photo`, which had no `is_video` and cannot be given one: an
-- ALTER TABLE cannot be made idempotent.
DROP TABLE IF EXISTS music_concert_photo;
CREATE TABLE IF NOT EXISTS music_concert_media (
  asset_id TEXT PRIMARY KEY,            -- Immich's id of the photo or video
  album_id TEXT NOT NULL,               -- the album of `music_concert_event.album_id`
  position INTEGER NOT NULL,            -- 0 for the first of the album: the favourites, oldest first, then the others
  file TEXT NOT NULL,                   -- the picture's file in `.data/concert-photos/`
  is_video INTEGER NOT NULL DEFAULT 0   -- 1 where the picture is the one of a video
);

-- What the owner has or wants, written by hand in `.data/music-collection.csv`: an artist, an album or a song a line.
-- `music-sync import-collection` makes this table exactly the file's lines. `mbid` is MusicBrainz's number where the line
-- names it. A line that is also in the listens is owned and heard; one that is not is owned or wanted and not yet heard.
CREATE TABLE IF NOT EXISTS music_collection (
  id INTEGER PRIMARY KEY,
  added_on TEXT,                        -- YYYY-MM-DD, or none when the day is not known
  kind TEXT NOT NULL CHECK (kind IN ('artist', 'album', 'song')),
  artist TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',       -- the album or the song; empty for an artist
  year INTEGER,
  status TEXT NOT NULL CHECK (status IN ('owned', 'want')),
  rating REAL,                          -- 0.5 to 5 in half steps, or none
  note TEXT,
  mbid TEXT,
  format TEXT                           -- what the owner has: cd, vinyl, digital, blu-ray, fysisk; free text, lowercase
);

-- What Discogs says the owner has or wants, exactly as `music-sync discogs` last fetched it; `instance_id` is the copy
-- in the collection (the release id for a want). The collection takes these lines over (`discogs::overlay`).
CREATE TABLE IF NOT EXISTS discogs_item (
  instance_id INTEGER PRIMARY KEY,
  release_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('owned', 'want')),
  artist TEXT NOT NULL,
  title TEXT NOT NULL,
  year INTEGER,
  format TEXT,                          -- cd, vinyl, kassett, digital; lowercase, several with commas
  label TEXT,
  catalogue_number TEXT,
  rating REAL,                          -- 0.5 to 5 in half steps, or none
  added_on TEXT,                        -- YYYY-MM-DD
  fetched_at INTEGER NOT NULL
);

-- What else Discogs says of a release (`music-sync discogs`): its genres and styles, and the master it belongs to with the
-- master's year, which is the year the work came out, where the release's own is a reissue's (or none).
CREATE TABLE IF NOT EXISTS discogs_detail (
  release_id INTEGER PRIMARY KEY,
  genres TEXT,                          -- separated by bars: a genre has commas in it
  styles TEXT,                          -- separated by bars
  master_id INTEGER,
  master_year INTEGER,
  fetched_at INTEGER NOT NULL
);

-- The cover of a release: the MusicBrainz release that names the Discogs release (its URL relation) and the Cover Art
-- Archive's front image of it, so the page shows it like a played album's. A row for every release asked about, with
-- none where MusicBrainz or the archive has none, so it is not asked again; delete a row to ask again.
CREATE TABLE IF NOT EXISTS discogs_cover (
  release_id INTEGER PRIMARY KEY,
  release_mbid TEXT,
  image_id TEXT,
  tried_at INTEGER NOT NULL
);

-- Every spelling of an album heard in `listens` and the album it is, so "B'Day" and "B'Day (Deluxe Edition)" are one
-- (`album_key.rs`; the hand-written `.data/music-albums.csv` overrides the key). Derived: `music-sync album-variants`
-- rewrites it, `listens` is never touched. `release_mbid` is the MusicBrainz release the file pins for the tracklist.
CREATE TABLE IF NOT EXISTS album_variant (
  release_name TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  album_name TEXT NOT NULL,
  album_artist TEXT NOT NULL,
  album_key TEXT NOT NULL,
  release_mbid TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (release_name, artist_name)
);
CREATE INDEX IF NOT EXISTS idx_album_variant_key ON album_variant (album_key);

-- The tracklist of an album as MusicBrainz has it, in the album's order, so a page shows every track and not only the
-- ones that were played. One release per album (`album_variant.release_mbid` where the file pins one, else the release
-- most plays are on); `music-sync album-tracklists` fills it, and an album with no row here keeps the list of what was heard.
CREATE TABLE IF NOT EXISTS album_tracklist (
  album_key TEXT PRIMARY KEY,
  release_mbid TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS album_track (
  album_key TEXT NOT NULL,
  disc INTEGER NOT NULL,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  recording_mbid TEXT,
  length_ms INTEGER,
  artist_credit TEXT,                   -- as MusicBrainz credits the track, «Artist feat. Guest»
  PRIMARY KEY (album_key, disc, position)
);

-- Every spelling of an artist and of a song heard in `listens`, and what it is called, so "Charli XCX" and "Charli xcx"
-- are one artist and "Die A Little Bit" and "Die a Little Bit" one song (`song_key.rs`). Derived: `music-sync variants`
-- rewrites them, `listens` is never touched.
CREATE TABLE IF NOT EXISTS artist_variant (
  artist_name TEXT PRIMARY KEY,
  artist_display TEXT NOT NULL,
  artist_key TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS song_variant (
  artist_name TEXT NOT NULL,
  track_name TEXT NOT NULL,
  song_name TEXT NOT NULL,
  song_key TEXT NOT NULL,
  PRIMARY KEY (artist_name, track_name)
);

-- `listens` with the artist, the track and the album under the one name each of them has: what the summaries and the
-- pages group by, so a spelling never makes a second entry. A listen with no variant row keeps its own spelling.
CREATE VIEW IF NOT EXISTS canon_listens AS
SELECT listens.listened_at, COALESCE(song_variant.song_name, listens.track_name) AS track_name,
       COALESCE(artist_variant.artist_display, listens.artist_name) AS artist_name, listens.release_name,
       listens.recording_mbid, listens.artist_mbid, listens.release_mbid, listens.duration_ms,
       album_variant.album_key, album_variant.album_name, album_variant.album_artist
FROM listens
LEFT JOIN artist_variant ON artist_variant.artist_name = listens.artist_name
LEFT JOIN song_variant ON song_variant.artist_name = listens.artist_name AND song_variant.track_name = listens.track_name
LEFT JOIN album_variant ON album_variant.release_name = listens.release_name AND album_variant.artist_name = listens.artist_name;

-- The addresses a page had before its spellings were joined: `entity_pages` has one row for the name they now share,
-- and the old address still reaches it. Derived (`music-sync entities`).
CREATE TABLE IF NOT EXISTS entity_alias (
  kind TEXT NOT NULL,
  old_slug TEXT NOT NULL,
  slug TEXT NOT NULL,
  PRIMARY KEY (kind, old_slug)
);

-- Listens whose time was guessed, not read from a source: `source` says which guess, so they can be told apart and
-- removed together (`music-sync import-lastfm-estimated`).
CREATE TABLE IF NOT EXISTS listen_date_estimate (
  listened_at INTEGER NOT NULL,
  track_name TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (listened_at, track_name, artist_name)
);

-- An artist's old names (2026-10-31), from the hand-written `.data/music-artists.csv`: "Marina and the Diamonds" is
-- now "MARINA". Read by `music-sync variants`, which gives the old name and the new one one artist.
CREATE TABLE IF NOT EXISTS artist_alias (
  alias_name TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL
);

-- Who MusicBrainz credits on a recording (2026-10-31), one row per artist in order: a collaboration is several, a group
-- such as "Aly & AJ" one. Fetched by `music-sync recording-credits`; `recording_credit_fetched` keeps a recording that
-- has no credit from being asked for again.
CREATE TABLE IF NOT EXISTS recording_credit (
  recording_mbid TEXT NOT NULL,
  position INTEGER NOT NULL,
  artist_mbid TEXT,
  artist_name TEXT NOT NULL,
  PRIMARY KEY (recording_mbid, position)
);
CREATE TABLE IF NOT EXISTS recording_credit_fetched (
  recording_mbid TEXT PRIMARY KEY,
  fetched_at INTEGER NOT NULL
);

-- A listened name that is several artists, split by `collab.rs` where no MusicBrainz credit says so (2026-10-31): only when
-- every part is an artist heard alone. Derived (`music-sync variants`).
CREATE TABLE IF NOT EXISTS artist_split (
  artist_name TEXT NOT NULL,
  position INTEGER NOT NULL,
  part_name TEXT NOT NULL,
  PRIMARY KEY (artist_name, position)
);

-- `canon_listens` with one row for each artist of a listen (2026-10-31): a collaboration counts for every artist on it,
-- found from MusicBrainz' credit of the recording, else from `artist_split`, else the listened name alone. What the
-- artist pages and the artist rankings group by; songs and albums keep reading `canon_listens`. `credited_as` is the
-- name the listen carries, the same for every artist of one listen, so a join on it finds who they were heard with.
CREATE VIEW IF NOT EXISTS canon_artist_listens AS
WITH parts AS (
  SELECT l.listened_at, l.track_name, l.artist_name AS credited_as, rc.artist_name AS part, rc.artist_mbid AS part_mbid
  FROM listens AS l JOIN recording_credit AS rc ON rc.recording_mbid = l.recording_mbid
  UNION ALL
  SELECT l.listened_at, l.track_name, l.artist_name, s.part_name, NULL
  FROM listens AS l JOIN artist_split AS s ON s.artist_name = l.artist_name
  WHERE NOT EXISTS (SELECT 1 FROM recording_credit AS rc WHERE rc.recording_mbid = l.recording_mbid)
  UNION ALL
  SELECT l.listened_at, l.track_name, l.artist_name, l.artist_name,
         COALESCE(l.artist_mbid, (SELECT m.artist_mbid FROM recording_metadata AS m WHERE m.recording_mbid = l.recording_mbid))
  FROM listens AS l
  WHERE NOT EXISTS (SELECT 1 FROM recording_credit AS rc WHERE rc.recording_mbid = l.recording_mbid)
    AND NOT EXISTS (SELECT 1 FROM artist_split AS s WHERE s.artist_name = l.artist_name)
)
SELECT l.listened_at, COALESCE(song_variant.song_name, l.track_name) AS track_name,
       COALESCE(artist_variant.artist_display, parts.part) AS artist_name, l.release_name,
       l.recording_mbid, parts.part_mbid AS artist_mbid, l.release_mbid, l.duration_ms,
       album_variant.album_key, album_variant.album_name, album_variant.album_artist, parts.credited_as
FROM parts
JOIN listens AS l ON l.listened_at = parts.listened_at AND l.track_name = parts.track_name AND l.artist_name = parts.credited_as
LEFT JOIN artist_variant ON artist_variant.artist_name = parts.part
LEFT JOIN song_variant ON song_variant.artist_name = l.artist_name AND song_variant.track_name = l.track_name
LEFT JOIN album_variant ON album_variant.release_name = l.release_name AND album_variant.artist_name = l.artist_name;
