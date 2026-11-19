-- Who MusicBrainz credits on a recording (2026-10-31), one row per artist in order: a collaboration is several, a group such as "Aly & AJ" one.
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
