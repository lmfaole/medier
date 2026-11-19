-- The cinema visits the calendar has from today on, shown as upcoming (`film-sync import-calendar`, 2026-10-28).
CREATE TABLE IF NOT EXISTS film_planned (
  uid TEXT PRIMARY KEY,
  on_date TEXT NOT NULL,
  at_time TEXT,
  title TEXT NOT NULL,
  cinema TEXT
);
