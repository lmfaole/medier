/**
 * Builds the API responses from D1.
 *
 * Every query lives in `SQL`, not inline in a function, so a reviewer can see
 * exactly what each endpoint reads without running it, and every row is checked
 * against its schema before anything reads it. The tables are recomputed by
 * `sync-rust/` on every sync — see `db/schema.sql` — so this file only ever
 * reads, never writes.
 */

import type { AppApi } from "@designsystem/config/api-files"
import { queryRows } from "@designsystem/config/d1-query"
import { MUSIC_ONLY_SQL, SummaryPeriodRow } from "@designsystem/contracts/music-tables"
import * as v from "valibot"

import type { HistoryData, RecentListen, WeeksData } from '../lib/types.ts'
import { MONTH } from '@designsystem/intl/listening'
import { coverArtUrl } from './cover-art.ts'
import { concerts } from './concerts.ts'
import { entities, entity, library } from './entities.ts'
import { months as monthsOf, years as yearsOf } from './spans.ts'

export { entities, entity, library }

/** A listen's album cover, from the recording, else its release, else its release group; the joins it reads are `LISTEN_COVER_JOINS`. */
const LISTEN_COVER_SQL = `COALESCE(
        CASE WHEN recording_metadata.caa_release_mbid IS NOT NULL AND recording_metadata.caa_id IS NOT NULL THEN recording_metadata.caa_release_mbid || '/' || recording_metadata.caa_id END,
        CASE WHEN by_release.caa_id IS NOT NULL THEN by_release.caa_release_mbid || '/' || by_release.caa_id END,
        CASE WHEN by_group.caa_id IS NOT NULL THEN by_group.caa_release_mbid || '/' || by_group.caa_id END)`
const LISTEN_COVER_JOINS = `LEFT JOIN recording_metadata USING (recording_mbid)
      LEFT JOIN release_cover AS by_release ON by_release.source_mbid = listens.release_mbid
      LEFT JOIN release_cover AS by_group ON by_group.source_mbid = recording_metadata.release_group_mbid`

const SQL = {
  periods: 'SELECT period_key FROM summary_periods ORDER BY period_key DESC',
  // Months with a listen, newest first, and the listens of one month: the ends of `idx_listens_time` for a month at a time.
  historyMonths: `SELECT DISTINCT strftime('%Y-%m', listened_at, 'unixepoch') AS month FROM listens WHERE ${MUSIC_ONLY_SQL} ORDER BY month DESC`,
  history: `SELECT listened_at, track_name, artist_name, release_name, ${LISTEN_COVER_SQL} AS cover
    FROM listens ${LISTEN_COVER_JOINS}
    WHERE ${MUSIC_ONLY_SQL} AND listened_at >= ? AND listened_at < ?
    ORDER BY listened_at DESC`,
  // The plays of each week (Monday to Sunday, UTC) since a time, and the three artists that led each: the listens of the latest weeks, grouped. `weekday 0` is the Sunday on or after a day, six days before it is the Monday.
  // The Mondays of the latest weeks, newest first: the week of a time (unix seconds), and the weeks before it, `n` of them in all.
  weekStarts: `WITH RECURSIVE weeks(start, n) AS (
      SELECT date(?, 'unixepoch', 'weekday 0', '-6 days'), 1
      UNION ALL SELECT date(start, '-7 days'), n + 1 FROM weeks WHERE n < ?)
    SELECT start FROM weeks ORDER BY start DESC`,
  weekPlays: `SELECT date(listened_at, 'unixepoch', 'weekday 0', '-6 days') AS week, COUNT(*) AS plays
    FROM listens WHERE ${MUSIC_ONLY_SQL} AND listened_at >= CAST(strftime('%s', ?) AS INTEGER)
    GROUP BY week ORDER BY week DESC`,
  weekArtists: `SELECT week, artist_name, plays FROM (
      SELECT date(listened_at, 'unixepoch', 'weekday 0', '-6 days') AS week, artist_name, COUNT(*) AS plays,
        ROW_NUMBER() OVER (PARTITION BY date(listened_at, 'unixepoch', 'weekday 0', '-6 days') ORDER BY COUNT(*) DESC, artist_name) AS place
      FROM listens WHERE ${MUSIC_ONLY_SQL} AND listened_at >= CAST(strftime('%s', ?) AS INTEGER)
      GROUP BY week, artist_name)
    WHERE place <= 3 ORDER BY week DESC, place`,
  // The one place the Worker reads `listens`: a handful of rows from the end of `idx_listens_time`, music only (`MUSIC_ONLY_SQL`; podcasts are not in `listens`).
  recent: `SELECT listened_at, track_name, artist_name, release_name, ${LISTEN_COVER_SQL} AS cover
    FROM listens ${LISTEN_COVER_JOINS}
    WHERE ${MUSIC_ONLY_SQL}
    ORDER BY listened_at DESC LIMIT ?`,
}

const HistoryMonthRow = v.object({ month: v.string() })

const HistoryRow = v.object({
  listened_at: v.number(),
  track_name: v.string(),
  artist_name: v.string(),
  release_name: v.nullable(v.string()),
  cover: v.nullable(v.string()),
})

/** A row of its query, in the SELECT's column order, which is the JSON's. */
const PeriodRow = v.pick(SummaryPeriodRow, ['period_key'])
type PeriodRow = v.InferOutput<typeof PeriodRow>

/** A row of its query, in the SELECT's column order, which is the JSON's. */
const RecentRow = v.object({
  listened_at: v.number(),
  track_name: v.string(),
  artist_name: v.string(),
  release_name: v.nullable(v.string()),
  cover: v.nullable(v.string()),
})

/** The period keys with data, newest first, "all" always included last. */
export async function periods(database: D1Database): Promise<string[]> {
  const rows = await queryRows(database, SQL.periods, PeriodRow)
  const periodKeys = rows.map((row: PeriodRow) => row.period_key)
  // "all" sorts after every year as a string, so it is already last.
  return periodKeys
}

const WeekPlaysRow = v.object({ week: v.string(), plays: v.number() })
const WeekArtistRow = v.object({ week: v.string(), artist_name: v.string(), plays: v.number() })

/** How many weeks the weekly summary shows, the one that is not over yet first. */
export const WEEKS_SHOWN = 8
const WeekStartRow = v.object({ start: v.string() })

/**
 * The latest weeks, the one that is not over yet first: the plays of each, how that differs from the week before (not for the week that is not over:
 * it has not had all of its days) and the three artists that led. A week with no plays is a week with nothing, not a gap in the list.
 */
export async function weeks(database: D1Database, now: Date): Promise<WeeksData> {
  // one week more than is shown, for the change of the oldest; the weeks are cut in SQLite, which knows what day a Monday is
  const starts = (await queryRows(database, SQL.weekStarts, WeekStartRow, Math.floor(now.getTime() / 1000), WEEKS_SHOWN + 1)).map((row) => row.start)
  const oldest = starts.at(-1)
  if (oldest === undefined) return { weeks: [] }
  const [plays, artists] = await Promise.all([queryRows(database, SQL.weekPlays, WeekPlaysRow, oldest), queryRows(database, SQL.weekArtists, WeekArtistRow, oldest)])
  const playsOf = new Map(plays.map((row) => [row.week, row.plays]))
  const result = starts.slice(0, WEEKS_SHOWN).map((start, index) => {
    const count = playsOf.get(start) ?? 0
    const before = playsOf.get(starts[index + 1] ?? '') ?? 0
    return {
      start,
      plays: count,
      change: index === 0 || before === 0 ? null : Math.round(((count - before) / before) * 100),
      ongoing: index === 0,
      topArtists: artists.filter((row) => row.week === start).map((row) => ({ artist: row.artist_name, plays: row.plays })),
    }
  })
  return { weeks: result }
}

/** How many recent listens the front page shows. */
export const RECENT_LIMIT = 20

/** The last listens, newest first, each with its album cover where one is known. */
export async function recent(database: D1Database, limit: number): Promise<RecentListen[]> {
  const rows = await queryRows(database, SQL.recent, RecentRow, limit)
  return rows.map((row) => ({
    at: row.listened_at,
    track: row.track_name,
    artist: row.artist_name,
    release: row.release_name,
    cover: coverArtUrl(row.cover),
  }))
}

/** The months with listens, once per database: the snapshot asks for every month's page and each would run the same query. */
const historyMonths = new WeakMap<D1Database, Promise<string[]>>()

function historyMonthsOf(database: D1Database): Promise<string[]> {
  const cached = historyMonths.get(database)
  if (cached !== undefined) return cached
  const months = queryRows(database, SQL.historyMonths, HistoryMonthRow).then((rows) => rows.map((row) => row.month))
  historyMonths.set(database, months)
  return months
}

/** The unix second a month (`YYYY-MM`) starts, in UTC, which is how the months of the page are cut. */
const monthStart = (month: string) => Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1) / 1000

/**
 * Every listen of one month, newest first, and the months to choose between, newest first. With no month, the newest.
 * `null` for a month with no listens, so the Worker answers 404.
 */
export async function history(database: D1Database, month: string | null): Promise<HistoryData | null> {
  const months = await historyMonthsOf(database)
  const chosen = month ?? months[0]
  if (chosen === undefined || !MONTH.test(chosen) || !months.includes(chosen)) return null
  const [year, number] = [Number(chosen.slice(0, 4)), Number(chosen.slice(5, 7))]
  const next = `${number === 12 ? year + 1 : year}-${String(number === 12 ? 1 : number + 1).padStart(2, '0')}`
  const rows = await queryRows(database, SQL.history, HistoryRow, monthStart(chosen), monthStart(next))
  return {
    month: chosen,
    months,
    listens: rows.map((row) => ({ at: row.listened_at, track: row.track_name, artist: row.artist_name, release: row.release_name, cover: coverArtUrl(row.cover) })),
  }
}

/**
 * Each API file, built from D1 and the request URL, with the parameter
 * defaults the files always had. The endpoint (`pages/api/[...file].ts`) serves this
 * map and the page's types (`ApiResponses`) come from it.
 */
/** The databases the snapshot opens for this API (`scripts/snapshot-app.ts`): the first is its own. */
export const DOMAINS = ['music'] as const

export const API = {
  periods: (database: D1Database) => periods(database),
  history: (database: D1Database, url: URL) => history(database, url.searchParams.get('month')),
  weeks: (database: D1Database) => weeks(database, new Date()),
  months: (database: D1Database) => monthsOf(database, new Date()),
  years: (database: D1Database) => yearsOf(database, new Date()),
  entities: (database: D1Database) => entities(database),
  library: (database: D1Database) => library(database),
  entity: (database: D1Database, url: URL) => entity(database, url.searchParams.get('kind'), url.searchParams.get('slug')),
  recent: (database: D1Database) => recent(database, RECENT_LIMIT),
  concerts: (database: D1Database) => concerts(database, new Date().toISOString().slice(0, 10)),
} satisfies AppApi

/** What each API file holds, for `RESPONSES` (`server/responses.ts`). `null` is a 404, never data. */
export type ApiResponses = { [File in keyof typeof API]: NonNullable<Awaited<ReturnType<(typeof API)[File]>>> }
