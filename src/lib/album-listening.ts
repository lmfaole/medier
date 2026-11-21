/**
 * What an album's page says of the visitor's own listening to it: its plays over time (one weekly album chart from Last.fm a stretch, shared by every album's page), their plays of each of its
 * tracks, how long it is and about how long they have listened to it. Pure, so a test pins it; `sources.ts` asks Last.fm for what it is read from.
 */

import { albumKey } from "./albums.ts"
import type { TopTrack } from "./lastfm.ts"
import { plain } from "./spotify.ts"

type Json = Record<string, unknown>
const object = (value: unknown): Json => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {})
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const text = (value: unknown): string => (typeof value === "string" ? value : "")

/** The user's albums in a stretch of time (unix seconds, `to` not included), the most played first: the same for every album's page, so it is asked once. */
export const albumChartUrl = (base: string, from: number, to: number): string => `${base}&method=user.getweeklyalbumchart&from=${from}&to=${to}`

/** One album of a chart: its title, its artist and its plays in the stretch. */
export interface ChartAlbum {
  title: string
  artist: string
  plays: number
}

export function parseAlbumChart(answer: unknown): ChartAlbum[] {
  return list(object(object(answer)["weeklyalbumchart"])["album"]).flatMap((value) => {
    const album = object(value)
    const title = text(album["name"]).trim()
    const artist = text(object(album["artist"])["#text"]).trim()
    const plays = Number(text(album["playcount"]))
    return title === "" || artist === "" || !Number.isFinite(plays) ? [] : [{ title, artist, plays }]
  })
}

/** The plays of an album in a chart: of all its editions («Junior», «Junior (Deluxe Edition)»), by the artist whatever its case; 0 where it is not in it. */
export const albumPlaysIn = (chart: readonly ChartAlbum[], artist: string, title: string): number =>
  chart.filter((one) => plain(one.artist) === plain(artist) && albumKey(one.title) === albumKey(title)).reduce((sum, one) => sum + one.plays, 0)

/**
 * The user's plays of each track of an album, from their most played songs of all time (their first thousand, `user.gettoptracks`): by title whatever its case, punctuation and edition
 * («- Remastered»). A track not among them is not in the map: it was played less than the thousandth song, or not at all.
 */
export function trackPlays(top: readonly TopTrack[], artist: string, titles: readonly string[]): Map<string, number> {
  const by = new Map<string, number>()
  for (const track of top) if (plain(track.artist) === plain(artist)) by.set(albumKey(track.title), (by.get(albumKey(track.title)) ?? 0) + track.plays)
  return new Map(titles.flatMap((title) => {
    const plays = by.get(albumKey(title))
    return plays === undefined ? [] : [[title, plays] as const]
  }))
}

/** How long the album is, in seconds: the sum of its tracks, only where every track's length is known. */
export function albumSeconds(tracks: readonly { seconds: number | null }[]): number | null {
  if (tracks.length === 0 || tracks.some((track) => track.seconds === null)) return null
  return tracks.reduce((sum, track) => sum + (track.seconds ?? 0), 0)
}

/** The fewest plays of an album that an estimate of the time spent on it is made from: with fewer, the length of the tracks played says more than an average. */
const FEWEST_PLAYS = 3

/**
 * About how long the user has listened to an album, in seconds: its plays (`album.getinfo`'s count of theirs) times the length of a play of it, which is the average of its tracks weighted by how
 * much they played each where their plays of the tracks are known (`trackPlays`), else the plain average. `null` where it would be a guess: too few plays, or the lengths of half the tracks unknown.
 */
export function listenedSeconds(tracks: readonly { title: string; seconds: number | null }[], plays: number | null, perTrack: ReadonlyMap<string, number>): number | null {
  const timed = tracks.filter((track): track is { title: string; seconds: number } => track.seconds !== null)
  if (plays === null || plays < FEWEST_PLAYS || timed.length === 0 || timed.length * 2 < tracks.length) return null
  const weighed = timed.filter((track) => (perTrack.get(track.title) ?? 0) > 0)
  const weight = weighed.reduce((sum, track) => sum + (perTrack.get(track.title) ?? 0), 0)
  const average = weight > 0 ? weighed.reduce((sum, track) => sum + track.seconds * (perTrack.get(track.title) ?? 0), 0) / weight : timed.reduce((sum, track) => sum + track.seconds, 0) / timed.length
  return plays * average
}

/** A length as «47 min» or «1 t 12 min». */
export function durationText(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} t${minutes % 60 === 0 ? "" : ` ${minutes % 60} min`}`
}

/** About how long, rounded as a person would say it: «omtrent 40 min», «omtrent 6 t», «omtrent 120 t». */
export function aboutText(seconds: number): string {
  const minutes = seconds / 60
  if (minutes < 55) return `omtrent ${Math.max(5, Math.round(minutes / 5) * 5)} min`
  const hours = minutes / 60
  return `omtrent ${(hours < 10 ? Math.round(hours * 2) / 2 : Math.round(hours)).toLocaleString("nb-NO")} t`
}
