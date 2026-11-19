# Apple Music import

Status: built 2026-10-30, and widened to the video and podcast files. The play log (`Apple Music Play Activity.csv`, not in the first uploads)
replaced Daily Tracks as the source of plays: exact start times, so nothing is estimated and nothing is filled in by guessing. Listens need 30 % of the track after pauses and scrubs are put together (changed the same day from Last.fm's
half-or-four-minutes rule), and an hour is never filled past what Apple has beyond the stored scrobbles. `docs/DATA.md` has what ran; this page is the first design.

## Goal

Keep what Apple knows about the owner's listening, the way Spotify's export is kept:
the original unchanged, the plays in the music database, and the months Last.fm
never scrobbled filled in. Nothing here goes into a published snapshot.

## What the export holds (measured 2026-10-30)

- `Apple_Music_-_Play_History_Daily_Tracks.csv`: one row per track, day and hour
  (`Date Played` yyyymmdd, `Hours`), with `Play Count`, `Skip Count`, `Play Duration
  Milliseconds`, `End Reason Type`, `Source Type`, `Media type` (`AUDIO` or `VIDEO`),
  `Track Identifier` and `Track Description` («Artist - Title»). 20 152 rows,
  17 473 plays, 2024-12-21 to 2026-07-21, with holes (almost nothing 2025-12-05 to
  2026-04-30).
- `Track_Play_History.csv` (last played per track), `Play_Statistics`, `Top_Content`
  and `Recently_Played_Containers` (album, playlist or radio each listening came
  from): summaries and context, no new plays.
- The library and `Import_*` JSON zips are the library, not plays.
- Last.fm already holds nearly every play Apple shows: June 2026 matches day by day
  within ±10 %. The real gaps in `listens` are January and February 2025 (Apple 3 348
  plays, `listens` none) and about 12 % of September 2025.

## What is imported, and what is only kept

Rule: a file becomes a table when it holds facts nothing else holds; a summary of
what another file already says, or a copy of another source, is kept as raw only
(so no number can disagree with another and no row exists twice).

| File | Result | Key (no duplicates) |
|---|---|---|
| Daily Tracks | `apple_play`, and fills `listens` | day, hour, track id, media type |
| Library Tracks | `apple_track`: artist, title, album, genre, year, length, date added, Apple's own play count. Resolves ids and names every other file | track id |
| Favorites (LIKE and DISLIKE of songs, albums, artists) | `apple_favorite`; read only, never pushed to Last.fm or Spotify | type, item reference |
| Library Playlists (the owner's own) | `apple_playlist`, `apple_playlist_track` in order, names through `apple_track` | container id, position |
| Identifier Information | fallback title for an id that is not in Library Tracks | track id |
| Track Play History, Play Statistics, Top Content, Container Details/Origin, Feature Statistics, Recently Played Tracks/Containers | raw only: sums or last-N views of Daily Tracks, and the container context is deferred | n/a |
| Library Albums/Artists | raw only: thin lists of titles and dates, already in `apple_track` | n/a |
| Library Import Tracks/Albums/Playlists | raw only: the Spotify transfer, a copy of `spotify_playlist` and friends | n/a |
| Siri Corrections (a handful of times Siri was corrected while a track played) | raw only: not listening | n/a |
| Library Activity (65 MB of account and device transactions) | raw only: not listening, and it names devices and the subscription | n/a |

## Design

1. **Land.** `npm run land -- apple-music <folder>` keeps the export as it came under
   `.data/raw/apple-music/<date>/`. Never moved, never rewritten.
2. **Import.** A Rust job `music-sync import-apple <folder> [--dry-run]`
   (`sync-rust/src/apple.rs`, the CSV reading in `crates/shared-data` beside
   `spotify_export`). Idempotent: running it twice changes nothing.
3. **`apple_play`** in `db/music.sql`: one row per (day, hour, track identifier,
   media type) with play count, skip count, duration, end reason, source, artist and
   title. Replaced from the export by key, never emptied. `VIDEO` rows are kept here
   and never reach `listens`.
4. **Filling `listens`.** For each audio row with plays that were not skipped, count
   the listens of the same track (the `twins.rs` matching `import-spotify` uses) in
   that hour. If Apple has N and `listens` has M < N, add N − M rows, placed evenly
   in the hour. Every added row is also written to `apple_play_filled` (the key of
   the `listens` row), so they can be told apart and removed with one statement.
   Nothing already in `listens` is changed or deleted.
5. **Not now.** The container context (which album or playlist) lands as raw only;
   a table for it is a later job when something reads it. `split-podcasts` runs
   after the import as the docs require.

## Open questions the plan must settle first

- **Artist and title.** `Library Tracks` gives artist, title and album per
  `Track Identifier`; use it for every id it holds. For an id it lacks, take
  `Identifier Information` for the title and the part of `Track Description` before
  the title for the artist (never split on a guessed « - »).
- **The hour's time zone.** Check `Hours` against hours of matching Last.fm listens
  (June 2026) before placing any row.
- **Which existing listens count as the same play** is decided by reading `twins.rs`.

## Tests

Parser (split, a quoted title, VIDEO and skipped rows), the N − M arithmetic, and
idempotence (second run adds nothing, `apple_play_filled` has no duplicates).

## Not done, and why

No publication, no page. The data is kept; showing it is a separate decision.
