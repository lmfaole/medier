/**
 * `/tilbakeblikk/maaned` and `/tilbakeblikk/aar`: the latest months and every year of listening, built as the weeks are (`weeks()` in `api.ts`): the plays of each, how they
 * differ from the one before and the three artists that led, grouped from `listens` at request time. Months and years are cut in UTC, like the weeks.
 */

import { queryRows } from '@designsystem/config/d1-query'
import { MUSIC_ONLY_SQL } from '@designsystem/contracts/music-tables'
import * as v from 'valibot'

import type { MonthsData, SpanSummary, YearsData } from '../lib/types.ts'

/** How many months the monthly summary shows, the one that is not over yet first. */
export const MONTHS_SHOWN = 12

/** The first day of the month or year a listen is in: how the plays are grouped. */
const KEY = { month: `strftime('%Y-%m-01', listened_at, 'unixepoch')`, year: `strftime('%Y-01-01', listened_at, 'unixepoch')` } as const
type Unit = keyof typeof KEY

const sql = (unit: Unit) => ({
  plays: `SELECT ${KEY[unit]} AS span, COUNT(*) AS plays
    FROM listens WHERE ${MUSIC_ONLY_SQL} AND listened_at >= CAST(strftime('%s', ?) AS INTEGER)
    GROUP BY span`,
  artists: `SELECT span, artist_name, plays FROM (
      SELECT ${KEY[unit]} AS span, artist_name, COUNT(*) AS plays,
        ROW_NUMBER() OVER (PARTITION BY ${KEY[unit]} ORDER BY COUNT(*) DESC, artist_name) AS place
      FROM listens WHERE ${MUSIC_ONLY_SQL} AND listened_at >= CAST(strftime('%s', ?) AS INTEGER)
      GROUP BY span, artist_name)
    WHERE place <= 3 ORDER BY span DESC, place`,
})

const PlaysRow = v.object({ span: v.string(), plays: v.number() })
const ArtistRow = v.object({ span: v.string(), artist_name: v.string(), plays: v.number() })
const StartRow = v.object({ start: v.string() })
const FirstRow = v.object({ first: v.nullable(v.string()) })

// The firsts of the latest months and of the years since a first one, newest first: SQLite knows what a month and a year are. `?` is a time (unix seconds).
const STARTS = {
  months: `WITH RECURSIVE spans(start, n) AS (
      SELECT date(?, 'unixepoch', 'start of month'), 1
      UNION ALL SELECT date(start, '-1 month'), n + 1 FROM spans WHERE n < ?)
    SELECT start FROM spans ORDER BY start DESC`,
  years: `WITH RECURSIVE spans(start) AS (
      SELECT date(?, 'unixepoch', 'start of year')
      UNION ALL SELECT date(start, '-1 year') FROM spans WHERE start > ?)
    SELECT start FROM spans ORDER BY start DESC`,
  first: `SELECT date(MIN(listened_at), 'unixepoch', 'start of year') AS first FROM listens WHERE ${MUSIC_ONLY_SQL}`,
}

/**
 * The summaries of `starts` (newest first; the one before the last is only read for the change of the last, so `shown` of them are returned).
 * The newest is not over, so it is not compared; a span with no plays is a span with nothing.
 */
async function summaries(database: D1Database, unit: Unit, starts: string[], shown: number): Promise<SpanSummary[]> {
  const oldest = starts.at(-1)
  if (oldest === undefined) return []
  const query = sql(unit)
  const [plays, artists] = await Promise.all([queryRows(database, query.plays, PlaysRow, oldest), queryRows(database, query.artists, ArtistRow, oldest)])
  const playsOf = new Map(plays.map((row) => [row.span, row.plays]))
  return starts.slice(0, shown).map((start, index) => {
    const count = playsOf.get(start) ?? 0
    const before = playsOf.get(starts[index + 1] ?? '') ?? 0
    return {
      start,
      plays: count,
      change: index === 0 || before === 0 ? null : Math.round(((count - before) / before) * 100),
      ongoing: index === 0,
      topArtists: artists.filter((row) => row.span === start).map((row) => ({ artist: row.artist_name, plays: row.plays })),
    }
  })
}

/** The latest months, the one that is not over yet first. */
export async function months(database: D1Database, now: Date): Promise<MonthsData> {
  // one month more than is shown, for the change of the oldest
  const starts = await queryRows(database, STARTS.months, StartRow, Math.floor(now.getTime() / 1000), MONTHS_SHOWN + 1)
  return { months: await summaries(database, 'month', starts.map((row) => row.start), MONTHS_SHOWN) }
}

/** Every year since the first listen, the one that is not over yet first. */
export async function years(database: D1Database, now: Date): Promise<YearsData> {
  const [row] = await queryRows(database, STARTS.first, FirstRow)
  if (row?.first == null) return { years: [] }
  const starts = (await queryRows(database, STARTS.years, StartRow, Math.floor(now.getTime() / 1000), row.first)).map((year) => year.start)
  return { years: await summaries(database, 'year', starts, starts.length) }
}
