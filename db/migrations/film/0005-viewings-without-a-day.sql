-- A viewing may have no known day, so `watched_on` stops being NOT NULL. The table is rebuilt (SQLite cannot drop the
-- constraint) with every row kept.
ALTER TABLE film_watch RENAME TO film_watch_old;
CREATE TABLE film_watch (
  id INTEGER PRIMARY KEY,
  watched_on TEXT,
  title TEXT NOT NULL,
  year INTEGER,
  rating REAL,
  rewatch INTEGER NOT NULL,
  note TEXT,
  tmdb_id INTEGER,
  cinema TEXT
);
INSERT INTO film_watch (id, watched_on, title, year, rating, rewatch, note, tmdb_id, cinema)
  SELECT id, watched_on, title, year, rating, rewatch, note, tmdb_id, cinema FROM film_watch_old;
DROP TABLE film_watch_old;
CREATE INDEX IF NOT EXISTS idx_film_watch_day ON film_watch (watched_on);
