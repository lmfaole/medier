/**
 * What an artist's page says of the visitor's own listening to it: the plays year by year and when it was first heard, its place among all they have heard, their most played songs by it, the
 * artists like it that they hear too, and what they played of it a year ago today. Pure, so a test pins it; `sources.ts` asks Last.fm for what it is read from.
 */

import type { ChartArtist, Play, SimilarArtist, TopArtist, TopTrack } from "./lastfm.ts"
import { dateAt, osloMidnight } from "./weeks.ts"

/** Names are the same artist whatever their case («AURORA» and «Aurora»). */
const same = (a: string, b: string): boolean => a.localeCompare(b, "nb", { sensitivity: "accent" }) === 0

/** A calendar year in Oslo time, as a half-open range of unix seconds. */
export interface YearRange {
  year: number
  start: number
  end: number
}

/** Each year from the one the user started in to the one `nowMs` is in, oldest first. */
export function yearRanges(registered: number, nowMs: number): YearRange[] {
  const first = dateAt(registered * 1000).year
  const last = dateAt(nowMs).year
  const years: YearRange[] = []
  for (let year = Math.max(first, last - 30); year <= last; year += 1) years.push({ year, start: osloMidnight(year, 1, 1), end: osloMidnight(year + 1, 1, 1) })
  return years
}

/** The months of a year in Oslo time, January first. */
export function monthRanges(year: number): { month: number; start: number; end: number }[] {
  return Array.from({ length: 12 }, (_, index) => ({ month: index + 1, start: osloMidnight(year, index + 1, 1), end: index === 11 ? osloMidnight(year + 1, 1, 1) : osloMidnight(year, index + 2, 1) }))
}

/** How many times the artist was played in a chart (0 where it is not in it). */
export const playsIn = (chart: readonly ChartArtist[], name: string): number => chart.find((one) => same(one.name, name))?.plays ?? 0

/**
 * The first of `items` (in order) that `has` says yes to, asking about whole runs of them at once: `has(from, to)` is whether any of `items[from..to]` is one. A dozen months take four questions, not twelve.
 * `null` where none is, or a question was not answered.
 */
export async function firstWith(count: number, has: (from: number, to: number) => Promise<boolean | null>): Promise<number | null> {
  let low = 0
  let high = count - 1
  const any = await has(low, high)
  if (any !== true) return null
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const before = await has(low, middle)
    if (before === null) return null
    if (before) high = middle
    else low = middle + 1
  }
  return low
}

/** The artist's place among all the user has heard (1 is the most played), its plays, and what share of all their plays it is (0 to 1); `null` where it is not among them. */
export function placeAmong(top: readonly TopArtist[], name: string, total: number | null): { rank: number; plays: number; share: number | null } | null {
  const index = top.findIndex((one) => same(one.name, name))
  const found = top[index]
  if (found === undefined) return null
  return { rank: index + 1, plays: found.plays, share: total === null || total <= 0 ? null : found.plays / total }
}

/** «3,1 %»; a share under a tenth of a percent is «under 0,1 %». */
export function shareText(share: number): string {
  const percent = share * 100
  return percent < 0.1 ? "under 0,1 %" : `${percent.toLocaleString("nb-NO", { maximumFractionDigits: percent < 10 ? 1 : 0 })} %`
}

/** The user's most played songs by the artist, most first, at most `limit`. */
export const tracksBy = (tracks: readonly TopTrack[], name: string, limit = 10): TopTrack[] => tracks.filter((track) => same(track.artist, name)).slice(0, limit)

/** Of the artists Last.fm finds like this one, those the user has played too, the most alike first, with their plays; at most `limit`. */
export function similarHeard(similar: readonly SimilarArtist[], top: readonly TopArtist[], name: string, limit = 6): { name: string; plays: number; url: string }[] {
  return similar.flatMap((one) => {
    if (same(one.name, name)) return []
    const heard = top.find((artist) => same(artist.name, one.name))
    return heard === undefined ? [] : [{ name: heard.name, plays: heard.plays, url: heard.url || one.url }]
  }).slice(0, limit)
}

/** The day a year before `nowMs` in Oslo (29 February is the 28th a year on), as a half-open range of unix seconds. */
export function yearAgoToday(nowMs: number): { start: number; end: number } {
  const today = dateAt(nowMs)
  const year = today.year - 1
  const days = new Date(Date.UTC(year, today.month, 0)).getUTCDate()
  const day = Math.min(today.day, days)
  const next = new Date(Date.UTC(year, today.month - 1, day + 1))
  return { start: osloMidnight(year, today.month, day), end: osloMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()) }
}

/** The artist's song the user played most on a day (the one played first, of two as many times), and how many times; `null` where they did not play it. */
export function mostPlayedOf(plays: readonly Play[], name: string): { track: string; plays: number } | null {
  const counts = new Map<string, { track: string; plays: number }>()
  for (const play of [...plays].reverse()) {
    if (!same(play.artist, name)) continue
    const key = play.track.toLowerCase()
    const found = counts.get(key) ?? { track: play.track, plays: 0 }
    found.plays += 1
    counts.set(key, found)
  }
  return [...counts.values()].reduce<{ track: string; plays: number } | null>((best, one) => (best === null || one.plays > best.plays ? one : best), null)
}

const ORDINALS = ["", "nest", "tredje", "fjerde", "femte", "sjette", "sjuende", "åttende", "niende", "tiende"] as const

/** «Din mest spilte artist», «Din fjerde mest spilte artist» up to the tenth, then «Nr. 42 av artistene dine»; «Artist» where its place is not known. */
export function artistKind(rank: number | null): string {
  if (rank === null) return "Artist"
  if (rank === 1) return "Din mest spilte artist"
  const word = ORDINALS[rank - 1]
  return word === undefined ? `Nr. ${rank.toLocaleString("nb-NO")} av artistene dine` : `Din ${word} mest spilte artist`
}

const MONTHS = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"] as const

/** «mars 2011», or «2011» where the month is not known. */
export const firstText = (first: { year: number; month: number | null }): string => (first.month === null ? String(first.year) : `${MONTHS[first.month - 1] ?? ""} ${first.year}`)

/** The lines under the artist's name in its head: how much the user has played it and what share of all, and since when. */
export function artistLines(plays: number | null, share: number | null, first: { year: number; month: number | null } | null): string[] {
  const amount = [plays === null ? null : `${plays.toLocaleString("nb-NO")} ${plays === 1 ? "avspilling" : "avspillinger"}`, share === null ? null : `${shareText(share)} av alt du har hørt`].filter((part) => part !== null)
  return [amount.join(" · "), first === null ? "" : `Først hørt i ${firstText(first)}`].filter((line) => line !== "")
}
