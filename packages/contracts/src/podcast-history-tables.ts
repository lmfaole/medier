/**
 * The table of `db/podcast_history.sql` podkast reads: the whole gpodder
 * listening log (Nextcloud gpoddersync, fed by AntennaPod on the owner's phone),
 * imported by `apps/podkast/sync-rust`. Unlike `podcast-tables.ts` (Spotify's
 * export and the scrobbles, a different database), this is every action the
 * player recorded — play, pause, seek, finish — with its position and time, so a
 * reader filters or counts what it needs. The test checks the columns against
 * the schema and the SQL against the cases that made it.
 */

import * as v from "valibot"

/**
 * One row of `episode_actions`: one action gpoddersync recorded. `timestamp_epoch`
 * is Unix seconds (the sort key); `timestamp` is the same moment, ISO 8601, filled
 * from the epoch when gpoddersync left it empty. `completed` is 1 when the action
 * marks the episode finished (a FINISH/COMPLETED action, or a position within 5 %
 * of the total).
 */
export const PodcastHistoryActionRow = v.object({
  id: v.number(),
  episode_key: v.string(),
  series_key: v.string(),
  episode_url: v.nullable(v.string()),
  guid: v.nullable(v.string()),
  action: v.nullable(v.string()),
  position: v.nullable(v.number()),
  started: v.nullable(v.number()),
  total: v.nullable(v.number()),
  timestamp: v.nullable(v.string()),
  timestamp_epoch: v.nullable(v.number()),
  completed: v.number(),
  series_title: v.nullable(v.string()),
  episode_title: v.nullable(v.string()),
  imported_at: v.string(),
})

/** One action of the listening log, as the page shows it: the names resolved, the rest as it happened. */
export const PodcastHistoryAction = v.object({
  at: v.nullable(v.number()),
  series: v.string(),
  episode: v.string(),
  action: v.string(),
  position: v.nullable(v.number()),
  total: v.nullable(v.number()),
  completed: v.number(),
})

/**
 * Every action, newest first, as `PodcastHistoryAction` rows. A title the Rust
 * import could not find in `podcasts.db` is already a label derived from the
 * feed or episode URL, so `series_title` and `episode_title` are read as they
 * are; only a row with neither falls back to its key, which never happens today
 * but keeps the log complete if it ever does.
 */
export const PODCAST_HISTORY_SQL = `
  SELECT timestamp_epoch AS at,
    COALESCE(NULLIF(series_title, ''), series_key) AS series,
    COALESCE(NULLIF(episode_title, ''), episode_key) AS episode,
    COALESCE(action, 'PLAY') AS action,
    position,
    total,
    completed
  FROM podcast_history.episode_actions
  ORDER BY timestamp_epoch DESC, id DESC`
