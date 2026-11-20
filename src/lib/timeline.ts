/**
 * The history (plays from Last.fm, viewings from Trakt) as the design system's timeline takes it: one event per play or viewing, and the sessions they make as
 * spans on a time axis. Pure, so a test pins it; a page only passes the result on.
 */

import type { ReactNode } from "react"
import type { IconName } from "@lmfaole/designsystem/lib/icons"

import type { Play } from "./lastfm.ts"
import { albumSlug, slugify } from "./pages.ts"
import { episodeCode, type Watch } from "./trakt.ts"
import { trackKey, TYPICAL_SECONDS } from "./wrapped.ts"

// Mirror of @lmfaole/designsystem/components/timeline and …/duration-bars (designsystem 8.47.0), to be replaced by imports once that version is in.
export type TimelineTone = "neutral" | "accent" | "success" | "warning" | "danger"

export interface TimelineActor {
  name: string
  avatar?: string
  href?: string
}

export interface TimelineEvent {
  id: string
  at: string
  kind: "comment" | "event"
  icon: IconName
  tone?: TimelineTone
  actor?: TimelineActor
  summary: string
  target?: { label: string; href?: string }
  body?: ReactNode
  href?: string
  group?: string
  /** Not in the contract yet: the disclosure's noun for this event's group («spor»), as group keys here are per album and cannot be listed up front. */
  groupNoun?: string
  badge?: string
}

export interface DurationSpan {
  key: string
  label: string
  start: string
  end?: string
  tone?: TimelineTone
  row?: string
}

/** The lane of the spans of each kind. */
export const MUSIC_ROW = "Musikk"
export const WATCH_ROW = "Film og TV"
/** A pause this long or longer ends a session. */
export const SESSION_GAP_MINUTES = 30
/** A viewing's length where TMDB does not tell it: a show's info has no episode length, and a film's may be missing. */
export const TYPICAL_EPISODE_MINUTES = 45
export const TYPICAL_FILM_MINUTES = 110

const MINUTE = 60_000

/** Newest first; a tie keeps the order it came in. */
const newestFirst = <T extends { at: string }>(events: readonly T[]): T[] => events.toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at))

/** Ids that are unique even where two items share a time (a double scrobble). */
function uniqueIds(events: readonly TimelineEvent[]): TimelineEvent[] {
  const seen = new Map<string, number>()
  return events.map((event) => {
    const count = (seen.get(event.id) ?? 0) + 1
    seen.set(event.id, count)
    return count === 1 ? event : { ...event, id: `${event.id}-${count}` }
  })
}

/**
 * The plays as timeline events, newest first: «spilte <spor – artist>». Plays of one album that follow each other share a group, so a run of them collapses
 * («Vis 9 spor til»); a play with no album is grouped by its artist (`groupBy: "artist"` groups every play that way). What is playing now (no time) is left out.
 * `href` is the track's link (the site's own page, say); the default is Last.fm's.
 */
export function playsTimeline(plays: readonly Play[], options: { groupBy?: "album" | "artist"; href?: (play: Play) => string | undefined } = {}): TimelineEvent[] {
  const { groupBy = "album", href = (play: Play) => play.url || undefined } = options
  const events = plays.flatMap((play): TimelineEvent[] => {
    if (play.playedAt === null) return []
    const link = href(play)
    const group = groupBy === "album" && play.album !== "" ? `album:${albumSlug(play.artist, play.album)}` : `artist:${slugify(play.artist)}`
    return [
      {
        id: `spilt-${Date.parse(play.playedAt) / 1000}`,
        at: play.playedAt,
        kind: "event",
        icon: "music",
        summary: "spilte",
        target: { label: `${play.track} – ${play.artist}`, ...(link === undefined ? {} : { href: link }) },
        ...(play.url === "" ? {} : { href: play.url }),
        group,
        groupNoun: "spor",
      },
    ]
  })
  return uniqueIds(newestFirst(events))
}

/** «Heat», «Andor, S2 E5». */
const watchLabel = (watch: Watch): string => (watch.episode === null ? watch.title : `${watch.title}, ${episodeCode(watch.episode)}`)

/**
 * The viewings as timeline events, newest first: «så <tittel>». Episodes of one show that follow each other share a group («Vis 6 episoder til»); a film stands alone.
 * `href` is the title's link (the site's page for it, say); the default is Trakt's.
 */
export function watchesTimeline(watches: readonly Watch[], options: { href?: (watch: Watch) => string | undefined } = {}): TimelineEvent[] {
  const { href = (watch: Watch) => watch.url || undefined } = options
  const events = watches.map((watch): TimelineEvent => {
    const link = href(watch)
    return {
      id: `sett-${watch.id}`,
      at: watch.watchedAt,
      kind: "event",
      icon: watch.kind === "film" ? "film" : "tv",
      summary: "så",
      target: { label: watchLabel(watch), ...(link === undefined ? {} : { href: link }) },
      ...(watch.url === "" ? {} : { href: watch.url }),
      ...(watch.episode === null ? {} : { group: `show:${slugify(watch.title)}`, groupNoun: "episoder" }),
    }
  })
  return uniqueIds(newestFirst(events))
}

/** The `groupNouns` the timeline takes today, from the events' own `groupNoun`. */
export function groupNounsOf(events: readonly TimelineEvent[]): Record<string, string> {
  const nouns: Record<string, string> = {}
  for (const event of events) if (event.group !== undefined && event.groupNoun !== undefined) nouns[event.group] ??= event.groupNoun
  return nouns
}

/** A stretch of time something took, in ISO, with what it was. */
export interface Interval {
  start: string
  end: string
  label: string
}

/** Each play from when it began to when it ended: its length where it is known (`lengths`, seconds by `trackKey`), a typical song's where it is not. */
export function playIntervals(plays: readonly Play[], lengths: ReadonlyMap<string, number> = new Map()): Interval[] {
  return plays.flatMap((play): Interval[] => {
    if (play.playedAt === null) return []
    const known = lengths.get(trackKey(play.artist, play.track))
    const seconds = known !== undefined && known > 0 ? known : TYPICAL_SECONDS
    return [{ start: play.playedAt, end: new Date(Date.parse(play.playedAt) + seconds * 1000).toISOString(), label: play.track }]
  })
}

/** Each viewing up to when it was marked as seen (Trakt's time is the end): a film's runtime where TMDB has it, a typical length where not. */
export function watchIntervals(watches: readonly Watch[]): Interval[] {
  return watches.map((watch) => {
    const minutes = watch.episode === null ? (watch.info?.runtime ?? TYPICAL_FILM_MINUTES) : TYPICAL_EPISODE_MINUTES
    const end = Date.parse(watch.watchedAt)
    return { start: new Date(end - minutes * MINUTE).toISOString(), end: new Date(end).toISOString(), label: watch.title }
  })
}

/**
 * The intervals (in any order) as sessions, oldest first: a session runs on while the next interval begins less than `gapMinutes` after the end of what came
 * before (overlaps included). `name` says what a session is called from what it holds.
 */
export function sessions(intervals: readonly Interval[], gapMinutes: number, options: { key: string; row: string; name: (items: readonly Interval[]) => string; tone?: TimelineTone }): DurationSpan[] {
  const runs: { start: number; end: number; items: Interval[] }[] = []
  for (const interval of intervals.toSorted((a, b) => Date.parse(a.start) - Date.parse(b.start))) {
    const start = Date.parse(interval.start)
    const end = Math.max(start, Date.parse(interval.end))
    const last = runs.at(-1)
    if (last !== undefined && start - last.end < gapMinutes * MINUTE) {
      last.items.push(interval)
      last.end = Math.max(last.end, end)
    } else runs.push({ start, end, items: [interval] })
  }
  return runs.map((run) => {
    const start = new Date(run.start).toISOString()
    return { key: `${options.key}-${start}`, label: options.name(run.items), start, end: new Date(run.end).toISOString(), row: options.row, ...(options.tone === undefined ? {} : { tone: options.tone }) }
  })
}

/** «Lytteøkt, 12 spor», in the music lane. */
export function listeningSessions(plays: readonly Play[], options: { lengths?: ReadonlyMap<string, number>; gapMinutes?: number } = {}): DurationSpan[] {
  return sessions(playIntervals(plays, options.lengths), options.gapMinutes ?? SESSION_GAP_MINUTES, { key: "lytteokt", row: MUSIC_ROW, name: (items) => `Lytteøkt, ${items.length} spor` })
}

/** One title by itself («Heat»), one show's episodes («Andor, 3 episoder»), or a mix («Titteøkt, 3 titler»), in the film and TV lane. */
export function watchSessions(watches: readonly Watch[], options: { gapMinutes?: number } = {}): DurationSpan[] {
  return sessions(watchIntervals(watches), options.gapMinutes ?? SESSION_GAP_MINUTES, {
    key: "titteokt",
    row: WATCH_ROW,
    name: (items) => {
      const titles = new Set(items.map((item) => item.label))
      const [only] = titles
      if (titles.size === 1 && only !== undefined) return items.length === 1 ? only : `${only}, ${items.length} episoder`
      return `Titteøkt, ${items.length} titler`
    },
  })
}
