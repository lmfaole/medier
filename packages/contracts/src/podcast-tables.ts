/**
 * The tables of `db/podcasts.sql` (written by music's `sync-rust`) that podkast reads, and what a
 * play of a podcast is. Spotify's export is the long history, with the minutes played; what
 * ListenBrainz and Last.fm scrobbled is the rest, without them. The test checks the columns
 * against the schema and the SQL against the cases that made it.
 */

import * as v from "valibot"

import { ListenRow } from "./music-tables.ts"

/** The shows that tell a podcast scrobble from a song (`artist_name` is how a scrobbler names the show). */
export const PodcastShowRow = v.object({
  artist_name: v.string(),
})

/** One row of `podcast_plays`: a play in Spotify's export, skips included. `started_at` is Unix seconds. */
export const PodcastPlayRow = v.object({
  started_at: v.number(),
  show_name: v.string(),
  episode_name: v.string(),
  episode_uri: v.string(),
  ms_played: v.number(),
  platform: v.nullable(v.string()),
  reason_end: v.nullable(v.string()),
})

/** One row of `podcast_listens`, a scrobble moved out of `listens`: the same columns, so the same row. */
export const PodcastListenRow = ListenRow

/** One row of `podcast_show_info`: what a show's feed and Apple's directory say about it. */
export const PodcastShowInfoRow = v.object({
  show_name: v.string(),
  itunes_id: v.nullable(v.number()),
  feed_url: v.nullable(v.string()),
  title: v.string(),
  author: v.nullable(v.string()),
  owner_name: v.nullable(v.string()),
  language: v.nullable(v.string()),
  itunes_country: v.nullable(v.string()),
  genre: v.nullable(v.string()),
  description: v.nullable(v.string()),
  website: v.nullable(v.string()),
  image_url: v.nullable(v.string()),
  apple_url: v.nullable(v.string()),
  fetched_at: v.number(),
})

/** One row of `podcast_feed_episode`: an episode as its show's feed has it. `published_at` is Unix seconds. */
export const PodcastFeedEpisodeRow = v.object({
  show_name: v.string(),
  guid: v.string(),
  title: v.string(),
  description: v.nullable(v.string()),
  published_at: v.nullable(v.number()),
  duration_s: v.nullable(v.number()),
  link: v.nullable(v.string()),
  season: v.nullable(v.number()),
  episode: v.nullable(v.number()),
})

/** One row of `podcast_person`: a person a feed names, of the show (`episode_guid` empty) or of an episode. */
export const PodcastPersonRow = v.object({
  show_name: v.string(),
  episode_guid: v.string(),
  name: v.string(),
  role: v.string(),
  href: v.nullable(v.string()),
})

/** One row of `podcast_show_country`: where a show is made, written by hand. */
export const PodcastShowCountryRow = v.object({
  show_name: v.string(),
  country: v.string(),
  note: v.nullable(v.string()),
})

/** One row of `podcast_feed_choice`: which feed is a show's, decided by hand. */
export const PodcastFeedChoiceRow = v.object({
  show_name: v.string(),
  feed_url: v.string(),
  note: v.nullable(v.string()),
})

/** A play of an episode, whichever source it came from. */
export const PodcastPlay = v.object({
  at: v.number(),
  show: v.string(),
  episode: v.string(),
  ms: v.number(),
})

/** Spotify's plays shorter than this are skips, not listening. */
export const MIN_PLAYED_MS = 60_000

/** A scrobble and a Spotify play of one episode this close (six hours) are the same listening. */
export const SAME_LISTENING_SECONDS = 21_600

/** The show of a clip that no scrobbler named as one of `podcast_shows`: a headline scrobbled as an artist, with no show to put it under. */
export const OTHER_CLIPS = "Andre klipp"

/**
 * Every play, oldest first, as `PodcastPlay` rows. ListenBrainz scrobbles name the show as the
 * artist and Last.fm scrobbles name it as the track, with the episode as the other, so a scrobble's
 * show is whichever of the two is a row of `podcast_shows` or a show Spotify's export has; a clip that is neither is an episode
 * (its headline, the artist) of `OTHER_CLIPS`.
 */
export const PODCAST_PLAYS_SQL = `
  WITH known AS (
    SELECT artist_name AS name FROM podcast_shows UNION SELECT show_name FROM podcast_plays
  ),
  scrobbles AS (
    SELECT listened_at AS at,
      CASE WHEN track_name IN (SELECT name FROM known) THEN track_name
           WHEN artist_name IN (SELECT name FROM known) THEN artist_name
           ELSE '${OTHER_CLIPS}' END AS show,
      CASE WHEN artist_name IN (SELECT name FROM known) THEN track_name ELSE artist_name END AS episode,
      COALESCE(duration_ms, 0) AS ms
    FROM podcast_listens
  )
  SELECT started_at AS at, show_name AS show, episode_name AS episode, ms_played AS ms
  FROM podcast_plays WHERE ms_played >= ${MIN_PLAYED_MS}
  UNION ALL
  SELECT at, show, episode, ms FROM scrobbles
  WHERE NOT EXISTS (
    SELECT 1 FROM podcast_plays AS spotify
    WHERE spotify.episode_name = scrobbles.episode AND abs(spotify.started_at - scrobbles.at) < ${SAME_LISTENING_SECONDS}
  )
  ORDER BY at`

/**
 * What `AntennaPod` recorded counts as a play when the player had got a minute into the episode, by the second it was
 * recorded. gpoddersync keeps the latest action of each episode, so how far the listener got (`position`) is what there is
 * to count. A hundred actions in one second are a «mark all as played», not listening, and are left out. A play that a
 * scrobble or Spotify's export already has (the same episode within `SAME_LISTENING_SECONDS`) is not counted twice.
 * Names whose `podcast_show_info` rows have the same feed are one show (a scrobbler's «TrueAnon» and the feed's «TRUE ANON
 * TRUTH FEED», or a show that changed its title), counted under the name that is the feed's title.
 * `podcast_history` is the attached database of `db/podcast_history.sql`; `tables` is what the tables of
 * `db/podcasts.sql` are called from the connection (empty when it is the main one, `podcasts.` when attached).
 */
export function podcastPlaysWithListeningSql(tables = ""): string {
  const base = PODCAST_PLAYS_SQL.replace(/\b(podcast_(?:shows|plays|listens))\b/g, `${tables}$1`)
  return `
  WITH base AS MATERIALIZED (SELECT at, show, episode, lower(episode) AS episode_key, ms FROM (${base})),
  same_feed AS (
    SELECT info.show_name AS name,
      (SELECT other.show_name FROM ${tables}podcast_show_info AS other WHERE other.feed_url = info.feed_url
       ORDER BY other.show_name = other.title DESC, other.itunes_id IS NULL, other.show_name LIMIT 1) AS show
    FROM ${tables}podcast_show_info AS info WHERE info.feed_url <> ''
  ),
  recorded AS (
    SELECT timestamp_epoch AS at, COALESCE(series_title, series_key) AS show, COALESCE(episode_title, episode_key) AS episode,
           lower(COALESCE(episode_title, episode_key)) AS episode_lc, position * 1000 AS ms
    FROM podcast_history.episode_actions AS action
    WHERE action IN ('PLAY', 'FINISH', 'COMPLETED') AND timestamp_epoch IS NOT NULL AND position >= ${MIN_PLAYED_MS / 1000}
      AND (SELECT count(*) FROM podcast_history.episode_actions AS same WHERE same.timestamp_epoch = action.timestamp_epoch) < ${MARK_ALL_AT_ONCE}
  )
  SELECT plays.at, COALESCE(same_feed.show, plays.show) AS show, plays.episode, plays.ms FROM (
    SELECT at, show, episode, ms FROM base
    UNION ALL
    SELECT at, show, episode, ms FROM recorded
    WHERE NOT EXISTS (
      -- A precomputed key, so SQLite can index the materialized base: lower() on both sides made this a scan per recorded play.
      SELECT 1 FROM base WHERE base.episode_key = recorded.episode_lc AND abs(base.at - recorded.at) < ${SAME_LISTENING_SECONDS}
    )
  ) AS plays LEFT JOIN same_feed ON same_feed.name = plays.show
  ORDER BY plays.at`
}

/** This many actions in the same second are a bulk mark, not a listening. */
export const MARK_ALL_AT_ONCE = 10

