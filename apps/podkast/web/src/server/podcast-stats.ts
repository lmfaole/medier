/**
 * What the podcast pages say about a list of plays, as pure functions of it: the top shows and episodes, and
 * the totals. Days and hours are Oslo's, since that is where the listening happened.
 */

import type * as v from 'valibot'

import type { PodcastPlay } from '@designsystem/contracts/podcast-tables'
import { playsPerYear } from '@designsystem/intl/listening'
import { slugOf } from '@designsystem/intl/text'

export type Play = v.InferOutput<typeof PodcastPlay>

const OSLO = { timeZone: 'Europe/Oslo' } as const

// Made once: building a formatter is the slow part, and a snapshot formats every play many times.
const yearFormat = new Intl.DateTimeFormat('en-CA', { ...OSLO, year: 'numeric' })
const hourFormat = new Intl.DateTimeFormat('en-GB', { ...OSLO, hour: '2-digit', hourCycle: 'h23' })
const yearOf = (at: number) => Number(yearFormat.format(at * 1000))
const hourOf = (at: number) => Number(hourFormat.format(at * 1000))

const toMinutes = (ms: number) => Math.round(ms / 60_000)

export interface TopShow {
  name: string
  plays: number
  episodes: number
  minutes: number
}

export interface TopEpisode {
  name: string
  show: string
  plays: number
  minutes: number
}

interface Tally {
  plays: number
  ms: number
}

/** Groups the plays by `keyOf` and ranks the groups by plays, ties by minutes and then by name, so a run is the same every time. */
function rank<Entry extends Tally & { name: string }>(plays: readonly Play[], keyOf: (play: Play) => string, start: (play: Play) => Entry, limit: number): Entry[] {
  const groups = new Map<string, Entry>()
  for (const play of plays) {
    const entry = groups.get(keyOf(play)) ?? start(play)
    entry.plays += 1
    entry.ms += play.ms
    groups.set(keyOf(play), entry)
  }
  return [...groups.values()].toSorted((a, b) => b.plays - a.plays || b.ms - a.ms || a.name.localeCompare(b.name)).slice(0, limit)
}

/** The shows with the most plays. */
export function topShows(plays: readonly Play[], limit: number): TopShow[] {
  const episodesOf = new Map<string, Set<string>>()
  for (const play of plays) episodesOf.set(play.show, (episodesOf.get(play.show) ?? new Set<string>()).add(play.episode))
  return rank(plays, (play) => play.show, (play) => ({ name: play.show, plays: 0, ms: 0 }), limit).map(({ name, plays: count, ms }) => ({
    name,
    plays: count,
    episodes: episodesOf.get(name)?.size ?? 0,
    minutes: toMinutes(ms),
  }))
}

/** The episodes played most often, an episode being its title within its show. */
export function topEpisodes(plays: readonly Play[], limit: number): TopEpisode[] {
  return rank(plays, (play) => `${play.show}\u0000${play.episode}`, (play) => ({ name: play.episode, show: play.show, plays: 0, ms: 0 }), limit).map(
    ({ name, show, plays: count, ms }) => ({ name, show, plays: count, minutes: toMinutes(ms) }),
  )
}

export interface Totals {
  plays: number
  minutes: number
  shows: number
  episodes: number
  firstAt: number | null
  lastAt: number | null
}

export function totalsOf(plays: readonly Play[]): Totals {
  return {
    plays: plays.length,
    minutes: toMinutes(plays.reduce((sum, play) => sum + play.ms, 0)),
    shows: new Set(plays.map((play) => play.show)).size,
    episodes: new Set(plays.map((play) => `${play.show}\u0000${play.episode}`)).size,
    firstAt: plays[0]?.at ?? null,
    lastAt: plays.at(-1)?.at ?? null,
  }
}

/** Plays per year, every year from the first to the last, so a year with none is a column of zero. */
export function perYear(plays: readonly Play[]): { year: number; plays: number }[] {
  return playsPerYear(plays.map((play) => yearOf(play.at)))
}

/** Plays per hour of the day, 24 entries, index 0 being midnight to one. */
export function perHour(plays: readonly Play[]): number[] {
  const hours = Array.from({ length: 24 }, () => 0)
  for (const play of plays) hours[hourOf(play.at)] = (hours[hourOf(play.at)] ?? 0) + 1
  return hours
}

/** Plays per month with a play, oldest first. */
export function perMonth(plays: readonly Play[]): { month: string; plays: number }[] {
  const months = new Map<string, number>()
  for (const play of plays) months.set(monthOf(play.at), (months.get(monthOf(play.at)) ?? 0) + 1)
  return [...months].toSorted(([a], [b]) => a.localeCompare(b)).map(([month, count]) => ({ month, plays: count }))
}

/** Plays per weekday, Monday first, on the days as Oslo has them. */
export function perWeekday(plays: readonly Play[]): number[] {
  const weekdays = Array.from({ length: 7 }, () => 0)
  for (const play of plays) {
    const index = (new Date(`${dayOf(play.at)}T00:00:00Z`).getUTCDay() + 6) % 7
    weekdays[index] = (weekdays[index] ?? 0) + 1
  }
  return weekdays
}

export interface RecentPlay {
  at: number
  show: string
  episode: string
}

/** The newest plays first. */
export function recentOf(plays: readonly Play[], limit: number): RecentPlay[] {
  return plays.slice(-limit).toReversed().map(({ at, show, episode }) => ({ at, show, episode }))
}

const dayFormat = new Intl.DateTimeFormat('en-CA', { ...OSLO, year: 'numeric', month: '2-digit', day: '2-digit' })

/** `YYYY-MM-DD` of a play, in Oslo. */
export const dayOf = (at: number): string => dayFormat.format(at * 1000)

/** `YYYY-MM` of a play, in Oslo. */
export const monthOf = (at: number): string => dayOf(at).slice(0, 7)

/** The months with a play, newest first. */
export function monthsOf(plays: readonly Play[]): string[] {
  return [...new Set(plays.map((play) => monthOf(play.at)))].toSorted().toReversed()
}

/** The years with a play, newest first. */
export function yearsOf(plays: readonly Play[]): string[] {
  return [...new Set(plays.map((play) => String(yearOf(play.at))))].toSorted().toReversed()
}

export const showSlug = (show: string) => slugOf(show)
export const episodeSlug = (show: string, episode: string) => slugOf(`${show}\u0000${episode}`)

export interface EntitySummary {
  kind: 'show' | 'episode'
  slug: string
  name: string
  /** The show of an episode. */
  show: string | null
  /** The path the app serves the show's picture at (an episode has its show's), or none. */
  cover: string | null
}

/** Every show and every episode there is a page for, shows first and each kind by name. */
export function entitiesOf(plays: readonly Play[], covers: ReadonlyMap<string, string> = new Map()): EntitySummary[] {
  const shows = new Set<string>()
  const episodes = new Map<string, { show: string; name: string }>()
  for (const play of plays) {
    shows.add(play.show)
    episodes.set(`${play.show}\u0000${play.episode}`, { show: play.show, name: play.episode })
  }
  return [
    ...[...shows].toSorted((a, b) => a.localeCompare(b)).map((name): EntitySummary => ({ kind: 'show', slug: showSlug(name), name, show: null, cover: covers.get(name) ?? null })),
    ...[...episodes.values()].toSorted((a, b) => a.show.localeCompare(b.show) || a.name.localeCompare(b.name)).map((episode): EntitySummary => ({ kind: 'episode', slug: episodeSlug(episode.show, episode.name), name: episode.name, show: episode.show, cover: covers.get(episode.show) ?? null })),
  ]
}

export interface ShowPage {
  kind: 'show'
  slug: string
  name: string
  totals: Totals
  years: { year: number; plays: number }[]
  topEpisodes: { name: string; slug: string; plays: number }[]
}

export interface EpisodePage {
  kind: 'episode'
  slug: string
  name: string
  show: { name: string; slug: string }
  totals: Totals
  /** When it was played, newest first, at most ten. */
  listens: number[]
}

/** The page of one show, or `null` for a name no play has. */
export function showPageOf(plays: readonly Play[], name: string): ShowPage | null {
  const own = plays.filter((play) => play.show === name)
  if (own.length === 0) return null
  return {
    kind: 'show',
    slug: showSlug(name),
    name,
    totals: totalsOf(own),
    years: perYear(own),
    topEpisodes: topEpisodes(own, 10).map((episode) => ({ name: episode.name, slug: episodeSlug(name, episode.name), plays: episode.plays })),
  }
}

/** The page of one episode of a show, or `null` for one no play has. */
export function episodePageOf(plays: readonly Play[], show: string, name: string): EpisodePage | null {
  const own = plays.filter((play) => play.show === show && play.episode === name)
  if (own.length === 0) return null
  return { kind: 'episode', slug: episodeSlug(show, name), name, show: { name: show, slug: showSlug(show) }, totals: totalsOf(own), listens: own.map((play) => play.at).toReversed().slice(0, 10) }
}

