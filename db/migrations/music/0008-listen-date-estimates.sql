-- Listens whose time was guessed, not read from a source (2026-10-31): `source` says which guess, so they can be told apart and removed together.
CREATE TABLE IF NOT EXISTS listen_date_estimate (
  listened_at INTEGER NOT NULL,
  track_name TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (listened_at, track_name, artist_name)
);
