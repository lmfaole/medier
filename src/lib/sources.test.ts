import { strict as assert } from "node:assert"
import { test } from "node:test"

import { type Env, type Get, loadMusic, loadNowPlaying, loadWatched, MAX_POSTER_LOOKUPS, settle, TTL } from "./sources.ts"

/** A `get` that answers from a table by the start of the address and remembers what was asked. */
function fake(answers: Record<string, unknown>, hits = new Set<string>()): { get: Get; asked: { url: string; ttl: number; method: string | undefined }[] } {
  const asked: { url: string; ttl: number; method: string | undefined }[] = []
  const get: Get = async (url, request) => {
    asked.push({ url, ttl: request.ttl, method: request.method })
    const found = Object.entries(answers).find(([start]) => url.startsWith(start))
    if (found === undefined) throw new Error(`nothing for ${url}`)
    return { data: found[1], hit: hits.has(url) }
  }
  return { get, asked }
}

const ENV: Env = { LASTFM_API_KEY: "k", LASTFM_USER: "someone", TRAKT_CLIENT_ID: "c", TRAKT_USER: "me", TMDB_API_KEY: "t" }
const RECENT = { recenttracks: { track: [{ name: "Ever", artist: { "#text": "After" }, album: { "#text": "Ever" }, url: "https://www.last.fm/x", date: { uts: "1700000000" }, image: [] }] } }

test("music asks for the recent plays and the top artists, each kept for its own time, and encodes the key and the user", async () => {
  const { get, asked } = fake({ "https://ws.audioscrobbler.com/2.0/": RECENT })
  const music = await loadMusic({ ...ENV, LASTFM_USER: "a b" }, get)
  assert.equal(music?.recent[0]?.track, "Ever")
  assert.deepEqual(asked.map((one) => one.ttl).sort((a, b) => a - b), [TTL.recent, TTL.topArtists])
  assert.ok(asked.every((one) => one.url.includes("&user=a%20b")))
})

test("the song Last.fm says is playing is not a finished play: it is `now`, and the plays are only the finished ones", async () => {
  const answer = { recenttracks: { track: [{ name: "Live", artist: { "#text": "Band" }, album: { "#text": "A" }, url: "https://www.last.fm/y", "@attr": { nowplaying: "true" }, image: [] }, ...RECENT.recenttracks.track] } }
  const music = await loadMusic(ENV, fake({ "https://ws.audioscrobbler.com/2.0/": answer }).get)
  assert.equal(music?.now?.track, "Live")
  assert.deepEqual(music?.recent.map((play) => play.track), ["Ever"])
})

test("a source whose key is not set is left out, not an error", async () => {
  const { get, asked } = fake({})
  assert.equal(await loadMusic({}, get), null)
  assert.equal(await loadWatched({}, get), null)
  assert.equal(await loadNowPlaying({}, get), null)
  assert.equal(await loadNowPlaying({ SPOTIFY_CLIENT_ID: "i", SPOTIFY_CLIENT_SECRET: "s" }, get), null)
  assert.deepEqual(asked, [])
})

function history(count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: index + 1, watched_at: `2026-11-${String(10 + (index % 18)).padStart(2, "0")}T12:00:00.000Z`, type: "movie", movie: { title: `Film ${index}`, year: 2020, ids: { slug: `film-${index}`, tmdb: 1000 + index } } }))
}

test("a cold page asks TMDB for no more than MAX_POSTER_LOOKUPS posters that were not kept, and the rest are filled in by later pages", async () => {
  const { get, asked } = fake({ "https://api.trakt.tv/": history(30).slice(0, 30), "https://api.themoviedb.org/": { poster_path: "/p.jpg" } })
  const watched = await loadWatched(ENV, get)
  const lookups = asked.filter((one) => one.url.startsWith("https://api.themoviedb.org/")).length
  assert.ok(lookups >= MAX_POSTER_LOOKUPS && lookups < MAX_POSTER_LOOKUPS + 6, `asked ${lookups}`)
  assert.ok((watched?.items.filter((item) => item.poster !== null).length ?? 0) < 30)
})

test("posters that are kept cost nothing against the limit, so every film gets its poster", async () => {
  const everything = new Set(history(30).map((entry) => `https://api.themoviedb.org/3/movie/${entry.movie.ids.tmdb}?api_key=t`))
  const { get } = fake({ "https://api.trakt.tv/": history(30), "https://api.themoviedb.org/": { poster_path: "/p.jpg" } }, everything)
  const watched = await loadWatched(ENV, get)
  assert.equal(watched?.items.filter((item) => item.poster !== null).length, 30)
})

test("a poster that cannot be fetched is left out and does not fail the page", async () => {
  const { get } = fake({ "https://api.trakt.tv/": history(2) })
  const watched = await loadWatched(ENV, get)
  assert.equal(watched?.items.length, 2)
  assert.ok(watched?.items.every((item) => item.poster === null))
})

test("now playing swaps the refresh token for an access token (kept under its own key) and asks with it", async () => {
  const calls: { url: string; method?: string; key?: string; auth?: string }[] = []
  const get: Get = async (url, request) => {
    calls.push({ url, ...(request.method === undefined ? {} : { method: request.method }), ...(request.key === undefined ? {} : { key: request.key }), ...(request.headers?.["Authorization"] === undefined ? {} : { auth: request.headers["Authorization"] }) })
    if (request.method === "POST") return { data: { access_token: "tok", expires_in: 3600 }, hit: false }
    return { data: { is_playing: true, currently_playing_type: "track", item: { name: "Submit", artists: [{ name: "Shygirl" }], album: { name: "S", images: [] }, external_urls: { spotify: "https://open.spotify.com/track/a" } } }, hit: false }
  }
  const playing = await loadNowPlaying({ SPOTIFY_CLIENT_ID: "i", SPOTIFY_CLIENT_SECRET: "s", SPOTIFY_REFRESH_TOKEN: "r" }, get)
  assert.equal(playing?.track, "Submit")
  assert.equal(calls[0]?.key, "spotify:token")
  assert.equal(calls[1]?.auth, "Bearer tok")
})

test("a token that was refused gives nothing playing, and a source that throws is null for settle", async () => {
  const refused: Get = async () => ({ data: { error: "invalid_grant" }, hit: false })
  assert.equal(await loadNowPlaying({ SPOTIFY_CLIENT_ID: "i", SPOTIFY_CLIENT_SECRET: "s", SPOTIFY_REFRESH_TOKEN: "r" }, refused), null)
  assert.equal(await settle(Promise.reject(new Error("down"))), null)
})

test("a TMDB that refuses every ask is asked no more than the limit either", async () => {
  const { get, asked } = fake({ "https://api.trakt.tv/": history(30) })
  await loadWatched(ENV, get)
  assert.ok(asked.filter((one) => one.url.startsWith("https://api.themoviedb.org/")).length < MAX_POSTER_LOOKUPS + 6)
})
