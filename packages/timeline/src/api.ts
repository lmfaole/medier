/**
 * The loader of `timeline.json`: the newest of the seven media apps that keep a log, read from their databases with the
 * queries each owner names (`@designsystem/contracts/media-timeline`). An app whose API has the file spreads this into
 * its `API` and names `TIMELINE_DOMAINS` as its `DOMAINS`. It holds only what those apps already show of their latest.
 */

import { queryRows } from '@designsystem/config/d1-query'
import { DayRow, FilmDayRow, ShelfDayRow, TIMELINE_FILM_SQL, TIMELINE_MUSIC_SQL, TIMELINE_PODCASTS_SQL, TIMELINE_TV_SQL, TimedRow, shelfTimelineSql } from '@designsystem/contracts/media-timeline'

import { dated, happened, merged, shelved, visited, timed, type TimelineEntry } from './timeline.ts'

/** The databases the loader reads: the first is the main one, the others are attached. */
export const TIMELINE_DOMAINS = ['music', 'podcasts', 'podcast_history', 'film', 'tv', 'games', 'books', 'boardgames'] as const

export async function timeline(db: D1Database): Promise<{ entries: TimelineEntry[] }> {
  const [music, podcasts, film, tv, games, books, boardgames] = await Promise.all([
    queryRows(db, TIMELINE_MUSIC_SQL, TimedRow),
    queryRows(db, TIMELINE_PODCASTS_SQL, TimedRow),
    queryRows(db, TIMELINE_FILM_SQL, FilmDayRow),
    queryRows(db, TIMELINE_TV_SQL, DayRow),
    queryRows(db, shelfTimelineSql('game', 'games'), ShelfDayRow),
    queryRows(db, shelfTimelineSql('book', 'books'), ShelfDayRow),
    queryRows(db, shelfTimelineSql('boardgame', 'boardgames'), ShelfDayRow),
  ])
  return { entries: merged(happened([...timed('music', music), ...timed('podkast', podcasts), ...visited('film', film), ...dated('tv', tv), ...shelved('games', games), ...shelved('books', books), ...shelved('boardgames', boardgames)])) }
}
