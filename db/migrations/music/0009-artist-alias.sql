-- An artist's old names (2026-10-31), from the hand-written `.data/music-artists.csv`: "Marina and the Diamonds" is now "MARINA".
CREATE TABLE IF NOT EXISTS artist_alias (
  alias_name TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL
);
