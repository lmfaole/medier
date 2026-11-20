/**
 * What a page needs from Last.fm, Trakt, TMDB and Spotify, asked for when the page is asked for. Each answer is kept for a while (`TTL`), so a page
 * is quick and the sources are asked little. Pure: the asking is done by the `get` that is passed in (`runtime.ts`), so a test hands it a fake one.
 */

import { type AlbumInfo, albumInfoUrl, type ArtistInfo, artistInfoUrl, type Music, parseAlbumInfo, parseArtistInfo, parseRecentTracks, parseTopArtists, parseTrackInfo, type TrackInfo, trackInfoUrl } from "./lastfm.ts"
import { type NowPlaying, NOW_PLAYING_URL, parseAlbumMatch, parseArtistMatch, parseNowPlaying, parseToken, parseTrackMatch, refreshRequest, searchAlbumUrl, searchArtistUrl, searchTrackUrl, type SpotifyAlbum, type SpotifyArtist, type SpotifyTrack } from "./spotify.ts"
import { authorize, detailsUrl, parseInfo, parsePerson, parsePoster, type Person, personUrl, type TitleInfo } from "./tmdb.ts"
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
export const TTL = { nowPlaying: 15, token: 3000, recent: 60, topArtists: 3600, history: 300, poster: 30 * 24 * 3600, artist: 24 * 3600, weekDone: 24 * 3600, weekLive: 300, firsts: 7 * 24 * 3600, length: 7 * 24 * 3600 } as const

/** Most of a page's asks that are not kept already: a cold page must stay well under a Worker's limit on what it may ask for. */
export const MAX_POSTER_LOOKUPS = 12
const POSTER_BATCH = 6

/**
 * Last.fm answers an error with HTTP 200 and a body of `{ "error": 29, "message": "…" }` (a rate limit, a method that is gone, an artist it does not know), so «ok» does not say the answer is one. The message of such an error, or `null` for
 * an answer that is not one. An error is never kept: the next ask may be right, and one that was kept would be shown for as long as it is kept.
 */
export function lastfmError(data: unknown): string | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null
  const body = data as Record<string, unknown>
  return typeof body["error"] === "number" && typeof body["message"] === "string" ? body["message"] : null
}

export const setting = (env: Env, name: string): string => env[name] ?? ""

/** The music, and the song Last.fm says is playing now (a scrobble of whatever plays, Spotify included), which is not a finished play and so not in `recent`. */
export interface Listening extends Music {
  now: NowPlaying | null
}

/** The start of every Last.fm address: the key and the user, or `null` where there is no key. */
export function lastfmBase(env: Env): string | null {
  const key = setting(env, "LASTFM_API_KEY")
  if (key === "") return null
  return `https://ws.audioscrobbler.com/2.0/?format=json&api_key=${encodeURIComponent(key)}&user=${encodeURIComponent(setting(env, "LASTFM_USER"))}`
}

export async function loadMusic(env: Env, get: Get): Promise<Listening | null> {
  const base = lastfmBase(env)
  if (base === null) return null
  const user = setting(env, "LASTFM_USER")
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
 * Each film and show asks TMDB once (kept for a month) for its poster and a few lines to know it by (plot, genres, length, vote), both from the one answer; at most
 * `MAX_POSTER_LOOKUPS` that were not kept are asked in one page, newest first, so the rest are filled in by the next pages. What cannot be fetched is left out: the row
 * shows an empty frame, the page no plot.
 */
export async function withPosters(items: readonly Watch[], tmdbKey: string, get: Get): Promise<Watch[]> {
  const posters = new Map<string, { poster: string | null; info: TitleInfo }>()
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
            posters.set(key, { poster: parsePoster(answer.data), info: parseInfo(answer.data) })
          } catch {
            // Left out: the row has an empty frame until a later page has it. A failure is an ask too, or a key TMDB refuses would be asked for every film.
            asked += 1
          }
        }),
      )
    }
  }
  return items.map((watch) => {
    const found = posters.get(`${watch.kind}:${watch.tmdbId}`)
    return { ...watch, poster: found?.poster ?? null, info: found?.info ?? null }
  })
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

/** A person from TMDB's page of them (their life story, dates and place), kept for a month; `null` where TMDB is not set up, does not know them, or did not answer. */
export async function loadPerson(env: Env, get: Get, id: number): Promise<Person | null> {
  const key = setting(env, "TMDB_API_KEY")
  if (key === "") return null
  const request = authorize(key, personUrl(id))
  return parsePerson((await get(request.url, { headers: request.headers, ttl: TTL.poster })).data)
}

/** What Last.fm says plays now: one play asked for, kept for as short a time as Spotify's answer, so the song and its cover follow each other. `null` where nothing plays or Last.fm is not set up. */
export async function loadLastfmNow(env: Env, get: Get): Promise<NowPlaying | null> {
  const base = lastfmBase(env)
  if (base === null) return null
  const playing = parseRecentTracks((await get(`${base}&method=user.getrecenttracks&limit=1`, { ttl: TTL.nowPlaying })).data).find((play) => play.playedAt === null)
  return playing === undefined ? null : { track: playing.track, artist: playing.artist, album: playing.album, image: playing.image, url: playing.url }
}

/** The song playing now on Spotify, or `null` (nothing plays, Spotify is not set up, or its token has run out: the page simply shows nothing). */
export async function loadNowPlaying(env: Env, get: Get): Promise<NowPlaying | null> {
  const token = await spotifyToken(env, get)
  if (token === null) return null
  const playing = await get(NOW_PLAYING_URL, { headers: { Authorization: `Bearer ${token}` }, ttl: TTL.nowPlaying, key: "spotify:now-playing" })
  return parseNowPlaying(playing.data)
}

/** The access token (an hour), made from the refresh token and kept for 50 minutes under its own key; `null` where Spotify is not set up or its sign-in has run out. */
async function spotifyToken(env: Env, get: Get): Promise<string | null> {
  const [clientId, secret, refresh] = [setting(env, "SPOTIFY_CLIENT_ID"), setting(env, "SPOTIFY_CLIENT_SECRET"), setting(env, "SPOTIFY_REFRESH_TOKEN")]
  if (clientId === "" || secret === "" || refresh === "") return null
  const request = refreshRequest(clientId, secret, refresh)
  return parseToken((await get(request.url, { method: request.method, headers: request.headers, body: request.body, ttl: TTL.token, key: "spotify:token" })).data)?.accessToken ?? null
}

/** An artist on Spotify by name, or `null` (not set up, not found under that name, or Spotify did not answer: a page without a picture is a page). */
async function spotifyArtist(token: string, name: string, get: Get): Promise<{ artist: SpotifyArtist | null; hit: boolean }> {
  try {
    const answer = await get(searchArtistUrl(name), { headers: { Authorization: `Bearer ${token}` }, ttl: TTL.artist })
    return { artist: parseArtistMatch(answer.data, name), hit: answer.hit }
  } catch {
    return { artist: null, hit: false }
  }
}

/** What an artist's page shows beyond its plays: Last.fm's tags, listeners and text, and Spotify's picture; each leaves out only itself when it fails. */
export async function loadArtist(env: Env, get: Get, name: string): Promise<{ lastfm: ArtistInfo | null; spotify: SpotifyArtist | null }> {
  const base = lastfmBase(env)
  const [lastfm, spotify] = await Promise.all([
    base === null ? null : settle(get(artistInfoUrl(base, name, setting(env, "LASTFM_USER")), { ttl: TTL.artist })).then((answer) => (answer === null ? null : parseArtistInfo(answer.data))),
    spotifyToken(env, get).then((token) => (token === null ? null : spotifyArtist(token, name, get).then((found) => found.artist))).catch(() => null),
  ])
  return { lastfm, spotify }
}

/** Last.fm's answer for an address, read; `null` where Last.fm is not set up or did not answer: the rest of the page is there. */
async function lastfmInfo<T>(env: Env, get: Get, address: (base: string, user: string) => string, parse: (answer: unknown) => T): Promise<T | null> {
  const base = lastfmBase(env)
  if (base === null) return null
  const answer = await settle(get(address(base, setting(env, "LASTFM_USER")), { ttl: TTL.artist }))
  return answer === null ? null : parse(answer.data)
}

/** What Spotify says of something found by a search (an album, a track), or `null`: not set up, not found under that name, or Spotify did not answer. */
async function spotifyFound<T>(env: Env, get: Get, address: string, match: (answer: unknown) => T | null): Promise<T | null> {
  try {
    const token = await spotifyToken(env, get)
    if (token === null) return null
    return match((await get(address, { headers: { Authorization: `Bearer ${token}` }, ttl: TTL.artist })).data)
  } catch {
    return null
  }
}

/** A track's page: Last.fm's tags, listeners, length and the owner's own count, and Spotify's link to it. */
export async function loadTrack(env: Env, get: Get, artist: string, track: string): Promise<{ lastfm: TrackInfo | null; spotify: SpotifyTrack | null }> {
  const [lastfm, spotify] = await Promise.all([
    lastfmInfo(env, get, (base, user) => trackInfoUrl(base, artist, track, user), parseTrackInfo),
    spotifyFound(env, get, searchTrackUrl(track, artist), (answer) => parseTrackMatch(answer, track, artist)),
  ])
  return { lastfm, spotify }
}

/** An album's page: Last.fm's tags, listeners, tracks and the owner's own count, and Spotify's link, day and number of tracks. */
export async function loadAlbum(env: Env, get: Get, artist: string, album: string): Promise<{ lastfm: AlbumInfo | null; spotify: SpotifyAlbum | null }> {
  const [lastfm, spotify] = await Promise.all([
    lastfmInfo(env, get, (base, user) => albumInfoUrl(base, artist, album, user), parseAlbumInfo),
    spotifyFound(env, get, searchAlbumUrl(album, artist), (answer) => parseAlbumMatch(answer, album, artist)),
  ])
  return { lastfm, spotify }
}

/** Spotify's picture of each artist in a list, asked for in the order of the list and no more than `MAX_POSTER_LOOKUPS` that were not kept in one page (the rest come with the next pages). */
export async function loadArtistPictures(env: Env, get: Get, names: readonly string[]): Promise<Map<string, SpotifyArtist>> {
  const found = new Map<string, SpotifyArtist>()
  const token = await spotifyToken(env, get).catch(() => null)
  if (token === null) return found
  const wanted = [...new Set(names)]
  let asked = 0
  for (let start = 0; start < wanted.length && asked < MAX_POSTER_LOOKUPS; start += POSTER_BATCH) {
    await Promise.all(
      wanted.slice(start, start + POSTER_BATCH).map(async (name) => {
        const result = await spotifyArtist(token, name, get)
        if (!result.hit) asked += 1
        if (result.artist !== null) found.set(name, result.artist)
      }),
    )
  }
  return found
}

/** What a page shows when a source is down: the others still show. */
export async function settle<T>(work: Promise<T>): Promise<T | null> {
  try {
    return await work
  } catch {
    return null
  }
}
