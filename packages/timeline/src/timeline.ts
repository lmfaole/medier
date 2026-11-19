/**
 * The latest of every media service in one list: the newest listens, plays, films, episodes, games, books and board games of the seven apps,
 * newest first, as the hub of the media apps and `forside`'s `/medier` show them. A viewing with a day and no clock shows no time
 * and stands after the timed entries of its day, so its place is never a guess at a clock.
 */

import { COVER_PATH } from '@designsystem/config/cover-archive'
import { showCoverPathOf } from '@designsystem/intl/podcast-covers'
import { coverPathOf } from '@designsystem/shelf/covers'
import { APPS } from '@designsystem/ui/lib/apps'
import { posterUrl } from '@designsystem/watch/viewing'

export const SERVICES = ['music', 'podkast', 'film', 'tv', 'games', 'books', 'boardgames'] as const
export type Service = (typeof SERVICES)[number]

/** One line of the timeline: `at` is an ISO instant, `hasTime` false for a day only. */
export interface TimelineEntry {
  app: Service
  at: string
  hasTime: boolean
  title: string
  subtitle: string | null
  /** A picture of it, the path the owning app serves it at on the same host, or `null`. */
  image: string | null
}

/** The most the timeline shows: the latest, not the history (that is each app's own `/history`). */
export const TIMELINE_LENGTH = 50

/** What each app builds its picture from (`media-timeline.ts`) as the path that app serves it at; a board game's cover is not kept, so it has none. */
function imageOf(app: Service, raw: string | null): string | null {
  if (raw === null) return null
  const path = {
    music: () => {
      const [release, id] = raw.split('/')
      const cover = `/covers/${release}/${id}-250.jpg`
      return COVER_PATH.test(cover) ? cover : null
    },
    podkast: () => showCoverPathOf(raw),
    film: () => posterUrl({ posterPath: raw }),
    tv: () => posterUrl({ posterPath: raw }),
    games: () => coverPathOf(raw),
    books: () => coverPathOf(raw),
    boardgames: () => null,
  }[app]()
  return path === null ? null : `${new URL(APPS[app].href).pathname.replace(/\/$/, '')}${path}`
}

export const timed = (app: Service, rows: readonly { at: number; title: string; subtitle: string | null; image: string | null }[]): TimelineEntry[] =>
  rows.map((row) => ({ app, at: new Date(row.at * 1000).toISOString(), hasTime: true, title: row.title, subtitle: row.subtitle, image: imageOf(app, row.image) }))

export const dated = (app: Service, rows: readonly { day: string; title: string; subtitle: string | null; image: string | null }[]): TimelineEntry[] =>
  rows.map((row) => ({ app, at: `${row.day}T12:00:00.000Z`, hasTime: false, title: row.title, subtitle: row.subtitle, image: imageOf(app, row.image) }))

const OSLO_OFFSET = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Oslo', timeZoneName: 'longOffset' })

/** The instant of a clock on a day in Oslo: the offset is read at that day's noon, so only a visit at night across a change of clock could be an hour off. */
function osloInstant(day: string, time: string): string {
  const offset = OSLO_OFFSET.formatToParts(new Date(`${day}T12:00:00Z`)).find((part) => part.type === 'timeZoneName')?.value.match(/([+-])(\d\d):(\d\d)/)
  const minutes = offset === null || offset === undefined ? 0 : (offset[1] === '-' ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3]))
  return new Date(Date.parse(`${day}T${time}:00Z`) - minutes * 60_000).toISOString()
}

/** A film line: a visit with a clock stands among the timed entries of its day, a viewing of a day only after them. */
export const visited = (app: Service, rows: readonly { day: string; time: string | null; title: string; subtitle: string | null; image: string | null }[]): TimelineEntry[] =>
  rows.map((row) => ({ app, at: row.time === null ? `${row.day}T12:00:00.000Z` : osloInstant(row.day, row.time), hasTime: row.time !== null, title: row.title, subtitle: row.subtitle, image: imageOf(app, row.image) }))

/** A line of a shelf app's log: its moment where the source knew it, else its day only. */
export const shelved = (app: Service, rows: readonly { day: string; at: number | null; title: string; subtitle: string | null; image: string | null }[]): TimelineEntry[] =>
  rows.flatMap((row) => (row.at === null ? dated(app, [row]) : timed(app, [{ ...row, at: row.at }])))

const OSLO_DAY = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' })

/** The day an entry is on, as the page shows it: a clock's is Oslo's, a day's is the day itself. */
const dayOf = (entry: TimelineEntry): string => (entry.hasTime ? OSLO_DAY.format(new Date(entry.at)) : entry.at.slice(0, 10))

/** What has happened by `now`: a planned visit or a booked ticket is not on the timeline until its time has come, and a day only is there from its own day. */
export const happened = (entries: readonly TimelineEntry[], now: Date = new Date()): TimelineEntry[] =>
  entries.filter((entry) => (entry.hasTime ? Date.parse(entry.at) <= now.getTime() : dayOf(entry) <= OSLO_DAY.format(now)))

/** Every service's entries merged, newest day first, the timed ones of a day newest first and then its day-only ones (in the order of `SERVICES`), the newest `TIMELINE_LENGTH`. */
export function merged(...lists: readonly (readonly TimelineEntry[])[]): TimelineEntry[] {
  return lists
    .flat()
    .toSorted((a, b) => dayOf(b).localeCompare(dayOf(a)) || Number(b.hasTime) - Number(a.hasTime) || (a.hasTime ? b.at.localeCompare(a.at) : 0) || SERVICES.indexOf(a.app) - SERVICES.indexOf(b.app))
    .slice(0, TIMELINE_LENGTH)
}
