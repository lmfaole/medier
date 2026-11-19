/**
 * The tables music owns (its schema, `db/<owner>.sql`, written by its
 * `sync-rust`) that another app reads. Each schema has every column, in the table's order; a
 * reader takes the columns its SELECT names with `v.pick`. The test checks
 * each one against music's `schema.sql`, so a change there fails here first.
 */

import * as v from "valibot"

/**
 * The WHERE condition that keeps a `listens` row if it is music: not a clip with no album
 * and no recording that lasts ten minutes or more. Podcast plays are not in `listens` at
 * all (`split-podcasts` moves them to `.data/podcasts.db`), so this is only a guard for a
 * clip that arrived since the last split. The Workers that read `listens` append it; the
 * Rust sync has the same text in `apps/music/sync-rust/src/scope.rs`.
 */
export const MUSIC_ONLY_SQL =
  "(listens.release_name IS NOT NULL OR listens.recording_mbid IS NOT NULL OR COALESCE(listens.duration_ms, 0) < 600000)"

/** One row of `summary_periods`: a period's totals and headline picks. */
export const SummaryPeriodRow = v.object({
  period_key: v.string(),
  total_listens: v.number(),
  total_minutes: v.number(),
  unique_artists: v.number(),
  unique_tracks: v.number(),
  top_artist_name: v.nullable(v.string()),
  top_track_name: v.nullable(v.string()),
  top_track_artist: v.nullable(v.string()),
  longest_streak_days: v.number(),
  current_streak_days: v.number(),
  computed_at: v.number(),
})

/** One row of `listens`, the raw import from ListenBrainz. `listened_at` is Unix seconds. */
export const ListenRow = v.object({
  listened_at: v.number(),
  track_name: v.string(),
  artist_name: v.string(),
  release_name: v.nullable(v.string()),
  recording_mbid: v.nullable(v.string()),
  artist_mbid: v.nullable(v.string()),
  release_mbid: v.nullable(v.string()),
  duration_ms: v.nullable(v.number()),
})

/** One row of `recording_genres`: a MusicBrainz genre of a recording, up to three per recording. */
export const RecordingGenreRow = v.object({
  recording_mbid: v.string(),
  genre: v.string(),
})

/** One row of `music_heard`: something the owner has heard that no scrobble says; `genres` is a JSON list. */
export const MusicHeardRow = v.object({
  id: v.number(),
  kind: v.string(),
  artist: v.string(),
  title: v.string(),
  year: v.nullable(v.number()),
  heard_on: v.nullable(v.string()),
  mbid: v.nullable(v.string()),
  genres: v.nullable(v.string()),
  looked_up_at: v.nullable(v.number()),
})

/** One row of `music_collection`: an artist, an album or a song the owner has or wants, as `music-collection.csv` has it. */
export const MusicCollectionRow = v.object({
  id: v.number(),
  added_on: v.nullable(v.string()),
  kind: v.string(),
  artist: v.string(),
  title: v.string(),
  year: v.nullable(v.number()),
  status: v.string(),
  rating: v.nullable(v.number()),
  note: v.nullable(v.string()),
  mbid: v.nullable(v.string()),
  format: v.nullable(v.string()),
})
