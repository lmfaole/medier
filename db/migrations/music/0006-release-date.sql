-- The full date a recording first came out, where MusicBrainz has more than the year; older rows have only `release_year` (2026-10-29).
ALTER TABLE recording_metadata ADD COLUMN release_date TEXT;
