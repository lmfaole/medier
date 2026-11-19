-- When a release group first came out, asked of MusicBrainz by `release-dates` (2026-10-29); `dated_at` is when it was asked, so a group with no date is not asked again.
ALTER TABLE release_group_info ADD COLUMN first_release_date TEXT;
ALTER TABLE release_group_info ADD COLUMN dated_at INTEGER;
