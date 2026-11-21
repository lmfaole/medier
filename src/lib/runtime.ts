/**
 * The Worker's end of `sources.ts`: its settings, and the `get` that asks a source, through the relay, and keeps the answer in the Worker's cache for as long
 * as the source's `ttl` says. A page imports the loaders below, which pass the one to the other; nothing else here is the page's business.
 */

import { env } from "cloudflare:workers"

import type { AstroCookies } from "astro"

import { type Env, forUsers, type Get, lastfmError, lastfmUserExists, type Listening, loadAlbum, loadAlbumDays, loadAlbumRelease, loadAlbumTimeline, loadArtist, loadArtistLinks, loadArtistListening, loadArtistPictures, loadLastfmNow, loadLatestRelease, loadMusic, loadPerson, loadTrack, loadTrackCovers, loadWatched, settle, traktUserExists } from "./sources.ts"
import { MOCK_VERSION, mockFetch, mockSettings } from "./mock.ts"
import { loadMonth, loadTrend, loadWeek, type Medium } from "./week-source.ts"
import type { Month } from "./months.ts"
import type { Week } from "./weeks.ts"
import type { NowPlaying } from "./spotify.ts"
import type { Watched } from "./trakt.ts"
import { readUsers, type Users } from "./users.ts"

const AGENT = "lmfaole-medier (https://github.com/lmfaole/medier)"
/** A cache key is an address; an answer that is kept under a name (a token) gets one that no one can ask the Worker for. */
const KEY_HOST = "https://cache.medier.invalid/"

/** The settings that are text: a secret or a variable that is not a string (a binding) is not one of ours. */
const own = (): Env => Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
/** `MOCK_DATA=1` (`.dev.vars`, never a Worker's secret): the sources are answered by `mock.ts`, with no keys and no network, and any username is one. */
export const mocking = (): boolean => own()["MOCK_DATA"] === "1"
export const settings = (): Env => (mocking() ? mockSettings(own()) : own())
/** The settings for one visitor: the Worker's keys and the visitor's usernames, never anyone else's. */
const settingsFor = (users: Users): Env => forUsers(settings(), users)

/** The visitor's usernames, from the request's cookies (`users.ts`). */
export const usersOf = (cookies: AstroCookies): Users => readUsers((name) => cookies.get(name)?.value)

/**
 * Workers on this zone cannot reach an origin outside Cloudflare (every such fetch ends in 525), while a Worker on workers.dev can: the relay (`upstream/`) is that
 * one, and asks on the page's behalf, only for the hosts it knows and only with the key the two share. Without a relay (`astro dev`) the source is asked directly.
 */
async function ask(url: string, request: { headers?: Record<string, string>; method?: "GET" | "POST"; body?: string }): Promise<Response> {
  if (mocking()) return mockFetch(url, request)
  const relay = settings()["UPSTREAM_URL"]
  const key = settings()["UPSTREAM_KEY"]
  const headers = { "User-Agent": AGENT, Accept: "application/json", ...request.headers }
  const init = { method: request.method ?? "GET", ...(request.body === undefined ? {} : { body: request.body }) }
  if (relay !== undefined && key !== undefined) {
    const target = new URL(url)
    return fetch(`${relay.replace(/\/$/, "")}/${target.host}${target.pathname}${target.search}`, { ...init, headers: { ...headers, "X-Upstream-Key": key } })
  }
  return fetch(url, { ...init, headers })
}

export const get: Get = async (url, request) => {
  const cache = caches.default
  // Made-up answers are kept apart, so a run on real data never gets one.
  const prefix = mocking() ? `mock:${MOCK_VERSION}:` : ""
  const kept = new Request(request.key === undefined && prefix === "" ? url : `${KEY_HOST}${encodeURIComponent(`${prefix}${request.key ?? url}`)}`)
  const found = await cache.match(kept)
  if (found !== undefined) {
    const data: unknown = await found.json()
    // An error of Last.fm's that was kept before errors were refused is not an answer: ask again, and the right one takes its place.
    if (lastfmError(data) === null) return { data, hit: true }
  }
  const response = await ask(url, request)
  if (!response.ok) throw new Error(`${new URL(url).host}: ${response.status}`)
  // 204 is «nothing» (nothing is playing): kept as that, so a quiet moment is not asked about again for its whole length either.
  const data: unknown = response.status === 204 ? null : await response.json()
  const refused = lastfmError(data)
  if (refused !== null) throw new Error(`${new URL(url).host}: ${refused}`)
  // Not being able to keep an answer (it is large, the cache is full) must not lose it: it is the answer, and the next ask simply asks again.
  await cache.put(kept, new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${request.ttl}` } })).catch(() => undefined)
  return { data, hit: false }
}

/** Each source on its own, for the visitor's usernames; `null` when it is not set up, the visitor has not given the username, or it is down: a page shows what it has. */
export const music = (users: Users): Promise<Listening | null> => settle(loadMusic(settingsFor(users), get))
export const watched = (users: Users): Promise<Watched | null> => settle(loadWatched(settingsFor(users), get))
export const lastfmNow = (users: Users): Promise<NowPlaying | null> => settle(loadLastfmNow(settingsFor(users), get))
export const artist = (users: Users, name: string) => loadArtist(settingsFor(users), get, name)
export const artistListening = (users: Users, name: string) => settle(loadArtistListening(settingsFor(users), get, name, Date.now()))
export const artistPictures = (names: readonly string[]) => loadArtistPictures(settings(), get, names)
export const latestRelease = (artist: string, mbid: string | null) => loadLatestRelease(get, artist, mbid, new Date().toISOString().slice(0, 10))
export const artistLinks = (mbid: string | null) => loadArtistLinks(get, mbid)
export const trackCovers = (users: Users, artist: string, titles: readonly string[]) => loadTrackCovers(settingsFor(users), get, artist, titles)
export const person = (id: number) => settle(loadPerson(settings(), get, id))
export const album = (users: Users, artist: string, title: string) => loadAlbum(settingsFor(users), get, artist, title)
export const albumTimeline = (users: Users, artist: string, title: string) => settle(loadAlbumTimeline(settingsFor(users), get, artist, title, Date.now()))
export const albumRelease = (users: Users, artist: string, title: string, credits: boolean) => settle(loadAlbumRelease(settingsFor(users), get, artist, title, { credits, pause: (ms) => (mocking() ? Promise.resolve() : new Promise((done) => setTimeout(done, ms))) }))
export const albumDays = (users: Users, artist: string, title: string) => settle(loadAlbumDays(settingsFor(users), get, artist, title, Date.now()))
export const track = (users: Users, artist: string, title: string) => loadTrack(settingsFor(users), get, artist, title)
export const week = (users: Users, which: Week, medium: Medium) => settle(loadWeek(settingsFor(users), get, which, Date.now(), medium))
export const month = (users: Users, which: Month, medium: Medium) => settle(loadMonth(settingsFor(users), get, which, Date.now(), medium))
export const trend = (users: Users, periods: readonly { id: string; start: number; end: number }[]) => settle(loadTrend(settingsFor(users), get, periods, Date.now()))

/** Whether the services have this username (a Trakt profile must be public); in a run on made-up data every name is one. */
export const lastfmUserFound = (user: string): Promise<boolean> => (mocking() ? Promise.resolve(true) : lastfmUserExists(settings(), get, user))
export const traktUserFound = (user: string): Promise<boolean> => (mocking() ? Promise.resolve(true) : traktUserExists(settings(), get, user))
