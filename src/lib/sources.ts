/**
 * What a page needs from Last.fm, Trakt, TMDB and Spotify, asked for when the page is asked for. Each answer is kept for a while (`TTL`), so a page
 * is quick and the sources are asked little. Pure: the asking is done by the `get` that is passed in (`runtime.ts`), so a test hands it a fake one.
 */

import { type Music, parseRecentTracks, parseTopArtists } from "./lastfm.ts"
import { type NowPlaying, NOW_PLAYING_URL, parseNowPlaying, parseToken, refreshRequest } from "./spotify.ts"
import { authorize, detailsUrl, parsePoster } from "./tmdb.ts"
import { mergeHistory, parseHistory, type Watch, type Watched } from "./trakt.ts"

/** The settings a Worker has: its secrets and its variables (`settings.ts`). A source whose key is not set is left out, not an error. */
export type Env = Readonly<Partial<Record<string, string>>>

export interface Request {
  headers?: Record<string, string>
  method?: "GET" | "POST"
  body?: string
  /** For how many seconds the answer is kept. */
  ttl: number
  /** What the answer is kept under; the address for a GET. A POST names its own. */
  key?: string
}

/** Asks for an address and gives the answer read as JSON, `null` for an answer with no body (204). `hit` is true when it came from what was kept. Throws on an error answer. */
export type Get = (url: string, request: Request) => Promise<{ data: unknown; hit: boolean }>

/** How long each kind of answer is kept, in seconds. A poster does not change; what is playing now does, quickly. */
export const TTL = { nowPlaying: 15, token: 3000, recent: 60, topArtists: 3600, history: 300, poster: 30 * 24 * 3600 } as const

/** Most of a page's asks that are not kept already: a cold page must stay well under a Worker's limit on what it may ask for. */
export const MAX_POSTER_LOOKUPS = 12
const POSTER_BATCH = 6

const setting = (env: Env, name: string): string => env[name] ?? ""

/** The music, and the song Last.fm says is playing now (a scrobble of whatever plays, Spotify included), which is not a finished play and so not in `recent`. */
export interface Listening extends Music {
  now: NowPlaying | null
}

export async function loadMusic(env: Env, get: Get): Promise<Listening | null> {
  const key = setting(env, "LASTFM_API_KEY")
  if (key === "") return null
  const user = setting(env, "LASTFM_USER")
  const base = `https://ws.audioscrobbler.com/2.0/?format=json&api_key=${encodeURIComponent(key)}&user=${encodeURIComponent(user)}`
  const [recent, top] = await Promise.all([
    get(`${base}&method=user.getrecenttracks&limit=50`, { ttl: TTL.recent }),
    get(`${base}&method=user.gettopartists&period=1month&limit=10`, { ttl: TTL.topArtists }),
  ])
  const plays = parseRecentTracks(recent.data)
  const playing = plays.find((play) => play.playedAt === null)
  const now = playing === undefined ? null : { track: playing.track, artist: playing.artist, album: playing.album, image: playing.image, url: playing.url }
  return { at: new Date().toISOString(), user, recent: plays.filter((play) => play.playedAt !== null), topArtists: parseTopArtists(top.data), now }
}

/**
 * Each film and show asks TMDB for its poster once (kept for a month); at most `MAX_POSTER_LOOKUPS` that were not kept are asked in one page, newest first,
 * so the rest are filled in by the next pages. A poster that cannot be fetched is left out: the row shows an empty frame.
 */
export async function withPosters(items: readonly Watch[], tmdbKey: string, get: Get): Promise<Watch[]> {
  const posters = new Map<string, string | null>()
  if (tmdbKey !== "") {
    const wanted = [...new Map(items.filter((watch) => watch.tmdbId !== null).map((watch) => [`${watch.kind}:${watch.tmdbId}`, watch])).entries()]
    let asked = 0
    for (let start = 0; start < wanted.length && asked < MAX_POSTER_LOOKUPS; start += POSTER_BATCH) {
      await Promise.all(
        wanted.slice(start, start + POSTER_BATCH).map(async ([key, watch]) => {
          try {
            const request = authorize(tmdbKey, detailsUrl(watch.kind, watch.tmdbId ?? 0))
            const answer = await get(request.url, { headers: request.headers, ttl: TTL.poster })
            if (!answer.hit) asked += 1
            posters.set(key, parsePoster(answer.data))
          } catch {
            // Left out: the row has an empty frame until a later page has it. A failure is an ask too, or a key TMDB refuses would be asked for every film.
            asked += 1
          }
        }),
      )
    }
  }
  return items.map((watch) => ({ ...watch, poster: posters.get(`${watch.kind}:${watch.tmdbId}`) ?? null }))
}

export async function loadWatched(env: Env, get: Get): Promise<Watched | null> {
  const clientId = setting(env, "TRAKT_CLIENT_ID")
  if (clientId === "") return null
  const user = setting(env, "TRAKT_USER")
  const headers = { "trakt-api-version": "2", "trakt-api-key": clientId }
  const page = async (kind: string) => parseHistory((await get(`https://api.trakt.tv/users/${encodeURIComponent(user)}/history/${kind}?limit=50`, { headers, ttl: TTL.history })).data)
  const [movies, episodes] = await Promise.all([page("movies"), page("episodes")])
  const items = mergeHistory(movies, episodes).slice(0, 50)
  return { at: new Date().toISOString(), user, items: await withPosters(items, setting(env, "TMDB_API_KEY"), get) }
}

/** The song playing now on Spotify, or `null` (nothing plays, Spotify is not set up, or its token has run out: the page simply shows nothing). */
export async function loadNowPlaying(env: Env, get: Get): Promise<NowPlaying | null> {
  const [clientId, secret, refresh] = [setting(env, "SPOTIFY_CLIENT_ID"), setting(env, "SPOTIFY_CLIENT_SECRET"), setting(env, "SPOTIFY_REFRESH_TOKEN")]
  if (clientId === "" || secret === "" || refresh === "") return null
  const request = refreshRequest(clientId, secret, refresh)
  const token = parseToken((await get(request.url, { method: request.method, headers: request.headers, body: request.body, ttl: TTL.token, key: "spotify:token" })).data)
  if (token === null) return null
  const playing = await get(NOW_PLAYING_URL, { headers: { Authorization: `Bearer ${token.accessToken}` }, ttl: TTL.nowPlaying, key: "spotify:now-playing" })
  return parseNowPlaying(playing.data)
}

/** What a page shows when a source is down: the others still show. */
export async function settle<T>(work: Promise<T>): Promise<T | null> {
  try {
    return await work
  } catch {
    return null
  }
}
