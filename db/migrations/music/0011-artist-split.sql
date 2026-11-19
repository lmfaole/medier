-- A listened name that is several artists, split where no MusicBrainz credit says so (2026-10-31): only when every part is an artist heard alone.
CREATE TABLE IF NOT EXISTS artist_split (
  artist_name TEXT NOT NULL,
  position INTEGER NOT NULL,
  part_name TEXT NOT NULL,
  PRIMARY KEY (artist_name, position)
);
