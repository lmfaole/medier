/**
 * What a week's wrapped needs from Last.fm and Trakt, asked for when the page is asked for, each answer kept for as long as it holds (a week that is over does not change; the week that is going on does).
 * A page may only ask a Worker's limit of questions, so what is not kept is asked for in turns: the lengths of songs and the artists that may be new come as far as the budget goes, newest and most played
 * first, and the rest are filled in by the next pages. Pure but for `get`, which is passed in, so a test hands it a fake one.
 */

import { type ChartArtist, artistChartUrl, artistPlaysBeforeUrl, type Play, parseArtistChart, parseArtistPlays, parseRecentPage, parseTrackInfo, playsInRangeUrl, trackInfoUrl } from "./lastfm.ts"
import { type Env, type Get, lastfmBase, setting, settle, TTL, withPosters } from "./sources.ts"
import { mergeHistory, parseHistory, type Watch } from "./trakt.ts"
import { isComplete, previousWeek, type Week } from "./weeks.ts"
import { artistsByPlays, trackKey, tracksByPlays, type WatchStats, type WeekStats, watchStats, weekStats } from "./wrapped.ts"

/** The most pages of plays (200 each) a week is read from: a week of more than this is cut, and says so. */
export const MAX_PLAY_PAGES = 8
/** The most questions about a song's length, and about an artist being new, a page asks that are not kept already. */
export const MAX_LENGTH_LOOKUPS = 10
export const MAX_FIRSTS_LOOKUPS = 8
/** The songs whose length is wanted, the most played first: the rest are counted at the average. */
const LENGTH_CANDIDATES = 30
/** The artists that are checked for being new, the most played first. */
const FIRSTS_CANDIDATES = 10
const BATCH = 6

export interface MusicWeek {
  stats: WeekStats
  /** The plays of the week were more than the pages read: the numbers are of the newest of them. */
  truncated: boolean
  /** The plays in the week before, `null` where it is not known. */
  previousTotal: number | null
  /** Of the most played artists, those that had never been played before the week: `null` where that could not be told. */
  newArtists: { name: string; plays: number }[] | null
}

export interface WeekData {
  week: Week
  /** The week is over: its numbers are final. */
  complete: boolean
  music: MusicWeek | null
  watched: { items: Watch[]; stats: WatchStats } | null
}

/** Runs `ask` over the items in batches, until `maxMisses` answers that were not kept have been had: what is kept costs nothing, so a page with most things kept finishes them all. */
async function within<T, R>(items: readonly T[], maxMisses: number, ask: (item: T) => Promise<{ value: R; hit: boolean }>): Promise<R[]> {
  const found: R[] = []
  let misses = 0
  for (let start = 0; start < items.length && misses < maxMisses; start += BATCH) {
    const answers = await Promise.all(items.slice(start, start + BATCH).map((item) => settle(ask(item))))
    for (const answer of answers) {
      if (answer === null) {
        misses += 1
        continue
      }
      if (!answer.hit) misses += 1
      found.push(answer.value)
    }
  }
  return found
}

/** Every finished play of the week, newest first, from the first page and as many of the others as the limit allows. */
async function readPlays(base: string, week: Week, get: Get, ttl: number): Promise<{ plays: Play[]; truncated: boolean }> {
  const first = parseRecentPage((await get(playsInRangeUrl(base, week.start, week.end, 1), { ttl })).data)
  const last = Math.min(first.totalPages, MAX_PLAY_PAGES)
  const rest = Array.from({ length: Math.max(0, last - 1) }, (_, index) => index + 2)
  const pages: Play[][] = []
  for (let start = 0; start < rest.length; start += BATCH) {
    const answers = await Promise.all(rest.slice(start, start + BATCH).map((page) => settle(get(playsInRangeUrl(base, week.start, week.end, page), { ttl }))))
    pages.push(...answers.map((answer) => (answer === null ? [] : parseRecentPage(answer.data).plays)))
  }
  return { plays: [...first.plays, ...pages.flat()], truncated: first.totalPages > MAX_PLAY_PAGES }
}

/** The lengths in seconds of the most played songs, as far as the limit on new questions goes. */
async function readLengths(env: Env, base: string, plays: readonly Play[], get: Get): Promise<Map<string, number>> {
  const user = setting(env, "LASTFM_USER")
  const lengths = new Map<string, number>()
  const found = await within(tracksByPlays(plays).slice(0, LENGTH_CANDIDATES), MAX_LENGTH_LOOKUPS, async (track) => {
    const answer = await get(trackInfoUrl(base, track.artist, track.title, user), { ttl: TTL.length })
    return { value: { key: trackKey(track.artist, track.title), seconds: parseTrackInfo(answer.data).seconds }, hit: answer.hit }
  })
  for (const one of found) if (one.seconds !== null) lengths.set(one.key, one.seconds)
  return lengths
}

/** Of the most played artists, those with no plays at all before the week began. `null` when not a single one could be asked about. */
async function readNewArtists(base: string, plays: readonly Play[], week: Week, get: Get): Promise<{ name: string; plays: number }[] | null> {
  const candidates = artistsByPlays(plays).slice(0, FIRSTS_CANDIDATES)
  const answered = await within(candidates, MAX_FIRSTS_LOOKUPS, async (artist) => {
    const answer = await get(artistPlaysBeforeUrl(base, artist.name, week.start), { ttl: TTL.firsts })
    return { value: { artist, before: parseArtistPlays(answer.data) }, hit: answer.hit }
  })
  const known = answered.filter((one) => one.before !== null)
  if (known.length === 0) return null
  return known.filter((one) => one.before === 0).map((one) => one.artist)
}

async function musicWeek(env: Env, get: Get, week: Week, ttl: number): Promise<MusicWeek | null> {
  const base = lastfmBase(env)
  if (base === null) return null
  const previous = previousWeek(week)
  const [{ plays, truncated }, chart] = await Promise.all([
    readPlays(base, week, get, ttl),
    settle(get(artistChartUrl(base, previous.start, previous.end), { ttl: TTL.weekDone })).then((answer): ChartArtist[] | null => (answer === null ? null : parseArtistChart(answer.data))),
  ])
  const [lengths, newArtists] = await Promise.all([readLengths(env, base, plays, get), readNewArtists(base, plays, week, get)])
  return { stats: weekStats(plays, chart, lengths), truncated, previousTotal: chart === null ? null : chart.reduce((sum, artist) => sum + artist.plays, 0), newArtists }
}

async function watchedWeek(env: Env, get: Get, week: Week, ttl: number): Promise<WeekData["watched"]> {
  const clientId = setting(env, "TRAKT_CLIENT_ID")
  if (clientId === "") return null
  const user = encodeURIComponent(setting(env, "TRAKT_USER"))
  const range = `start_at=${encodeURIComponent(new Date(week.start * 1000).toISOString())}&end_at=${encodeURIComponent(new Date((week.end - 1) * 1000).toISOString())}&limit=100`
  const headers = { "trakt-api-version": "2", "trakt-api-key": clientId }
  const page = async (kind: string) => parseHistory((await get(`https://api.trakt.tv/users/${user}/history/${kind}?${range}`, { headers, ttl })).data)
  const [movies, episodes] = await Promise.all([page("movies"), page("episodes")])
  const items = await withPosters(mergeHistory(movies, episodes), setting(env, "TMDB_API_KEY"), get)
  return { items, stats: watchStats(items) }
}

/** A week's wrapped from Last.fm and Trakt. Each part leaves out only itself when its source is not set up or fails. */
export async function loadWeek(env: Env, get: Get, week: Week, nowMs: number): Promise<WeekData> {
  const complete = isComplete(week, nowMs)
  const ttl = complete ? TTL.weekDone : TTL.weekLive
  const [music, watched] = await Promise.all([settle(musicWeek(env, get, week, ttl)), settle(watchedWeek(env, get, week, ttl))])
  return { week, complete, music, watched }
}
