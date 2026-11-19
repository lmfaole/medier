-- The first form of the view had the listen's own artist id for every artist of a collaboration (2026-10-31); `db/music.sql` makes it again with each artist's own.
DROP VIEW IF EXISTS canon_artist_listens;
