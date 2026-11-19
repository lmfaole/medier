-- The moment of a log line where the source knows it (2026-10-28), unix seconds; `on_date` stays the day.
ALTER TABLE book_entry ADD COLUMN at INTEGER;
ALTER TABLE book_collection ADD COLUMN at INTEGER;
