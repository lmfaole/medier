import { strict as assert } from "node:assert"
import { test } from "node:test"

import { type Env, type Get, loadAlbum, loadArtist, loadArtistPictures, loadMusic, loadNowPlaying, lastfmError, loadPerson, loadTrack, loadWatched, MAX_POSTER_LOOKUPS, settle, TTL } from "./sources.ts"

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
  const everything = new Set(history(30).map((entry) => `https://api.themoviedb.org/3/movie/${entry.movie.ids.tmdb}?language=nb-NO&append_to_response=credits&api_key=t`))
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

const SPOTIFY: Env = { LASTFM_API_KEY: "k", LASTFM_USER: "u", SPOTIFY_CLIENT_ID: "i", SPOTIFY_CLIENT_SECRET: "s", SPOTIFY_REFRESH_TOKEN: "r" }
const hit = (name: string) => ({ artists: { items: [{ name, genres: ["pop"], external_urls: { spotify: "https://open.spotify.com/artist/1" }, images: [{ url: "p.jpg", width: 320 }] }] } })

/** A `get` for Spotify: the token, and a search that finds the artist named in `q` unless it is in `missing`. */
function spotify(missing: string[] = [], hits = new Set<string>()): { get: Get; searches: string[] } {
  const searches: string[] = []
  const get: Get = async (url, request) => {
    if (request.method === "POST") return { data: { access_token: "tok" }, hit: false }
    if (url.startsWith("https://ws.audioscrobbler.com/")) return { data: { artist: { tags: { tag: [{ name: "pop" }] }, stats: { listeners: "10" }, bio: { summary: "x" } } }, hit: false }
    const name = decodeURIComponent(new URL(url).searchParams.get("q") ?? "").replace(/^artist:"|"$/g, "")
    searches.push(name)
    return { data: missing.includes(name) ? { artists: { items: [] } } : hit(name), hit: hits.has(url) }
  }
  return { get, searches }
}

test("an artist's page has Last.fm's tags and Spotify's picture, each kept for a day", async () => {
  const { get } = spotify()
  const got = await loadArtist(SPOTIFY, get, "Troye Sivan")
  assert.deepEqual(got.lastfm?.tags, ["pop"])
  assert.equal(got.spotify?.url, "https://open.spotify.com/artist/1")
})

test("an artist without Spotify set up, or one Spotify does not know, has no picture and the rest of the page is there", async () => {
  const none = await loadArtist({ LASTFM_API_KEY: "k", LASTFM_USER: "u" }, spotify().get, "Anyone")
  assert.equal(none.spotify, null)
  assert.deepEqual(none.lastfm?.tags, ["pop"])
  const unknown = await loadArtist(SPOTIFY, spotify(["Anyone"]).get, "Anyone")
  assert.equal(unknown.spotify, null)
})

test("a source that fails leaves out only its own part of the artist's page", async () => {
  const failing: Get = async (url) => {
    if (url.startsWith("https://ws.audioscrobbler.com/")) throw new Error("down")
    return spotify().get(url, { ttl: 1 })
  }
  const got = await loadArtist(SPOTIFY, failing, "Anyone")
  assert.equal(got.lastfm, null)
})

test("a list's pictures are asked for in its order, each name once, and no more than the limit that were not kept", async () => {
  const names = Array.from({ length: 30 }, (_, index) => `Artist ${index}`)
  const { get, searches } = spotify()
  const pictures = await loadArtistPictures(SPOTIFY, get, [...names, ...names])
  assert.ok(searches.length >= MAX_POSTER_LOOKUPS && searches.length < MAX_POSTER_LOOKUPS + 6, `searched ${searches.length}`)
  assert.equal(new Set(searches).size, searches.length)
  assert.deepEqual(searches.slice(0, 3), ["Artist 0", "Artist 1", "Artist 2"])
  assert.equal(pictures.size, searches.length)
})

test("pictures that are kept cost nothing against the limit, and without Spotify there are none", async () => {
  const names = Array.from({ length: 20 }, (_, index) => `Artist ${index}`)
  const kept = new Set(names.map((name) => `https://api.spotify.com/v1/search?type=artist&limit=10&q=${encodeURIComponent(`artist:"${name}"`)}`))
  assert.equal((await loadArtistPictures(SPOTIFY, spotify([], kept).get, names)).size, 20)
  assert.equal((await loadArtistPictures({ LASTFM_API_KEY: "k" }, spotify().get, names)).size, 0)
})

test("a person is asked for by TMDB's id and read; without a key, or for someone TMDB does not know, there is nothing", async () => {
  const asked: string[] = []
  const get: Get = async (url) => {
    asked.push(url)
    return { data: url.includes("/person/7?") ? { name: "Al Pacino", known_for_department: "Acting" } : { success: false }, hit: false }
  }
  assert.equal((await loadPerson(ENV, get, 7))?.name, "Al Pacino")
  assert.equal(await loadPerson(ENV, get, 8), null)
  assert.equal(await loadPerson({}, get, 7), null)
  assert.equal(asked.length, 2)
  assert.ok(asked[0]?.startsWith("https://api.themoviedb.org/3/person/7?language=nb-NO"))
})

/** A `get` for album and track pages: Last.fm's info, Spotify's token and a search that finds what is asked for unless `missing`. */
function musicGet(over: { lastfm?: unknown; missing?: boolean } = {}): { get: Get; asked: string[] } {
  const asked: string[] = []
  const get: Get = async (url, request) => {
    asked.push(url)
    if (request.method === "POST") return { data: { access_token: "tok" }, hit: false }
    if (url.startsWith("https://ws.audioscrobbler.com/")) {
      if (over.lastfm === "down") throw new Error("down")
      return { data: url.includes("track.getinfo") ? { track: { duration: "200000", listeners: "10", userplaycount: "4" } } : { album: { listeners: "5", userplaycount: "2", tracks: { track: [{ name: "One", duration: "100" }] } } }, hit: false }
    }
    if (over.missing === true) return { data: { albums: { items: [] }, tracks: { items: [] } }, hit: false }
    return { data: { albums: { items: [{ name: "LP", artists: [{ name: "Band" }], release_date: "2023-01-02", total_tracks: 9, external_urls: { spotify: "https://open.spotify.com/album/z" } }] }, tracks: { items: [{ name: "Song", artists: [{ name: "Band" }], external_urls: { spotify: "https://open.spotify.com/track/s" } }] } }, hit: false }
  }
  return { get, asked }
}

test("an album's page has Last.fm's info for it and Spotify's day, tracks and link, each asked for by artist and name", async () => {
  const { get, asked } = musicGet()
  const got = await loadAlbum(SPOTIFY, get, "Band", "LP")
  assert.equal(got.lastfm?.userPlays, 2)
  assert.deepEqual(got.lastfm?.tracks, [{ title: "One", seconds: 100 }])
  assert.deepEqual(got.spotify, { url: "https://open.spotify.com/album/z", released: "2023-01-02", tracks: 9 })
  assert.ok(asked.some((url) => url.includes("album.getinfo") && url.includes("artist=Band") && url.includes("album=LP") && url.includes("username=u")))
})

test("a track's page has Last.fm's length and count and Spotify's link; a source that fails leaves out only its own part", async () => {
  const both = await loadTrack(SPOTIFY, musicGet().get, "Band", "Song")
  assert.equal(both.lastfm?.seconds, 200)
  assert.equal(both.spotify?.url, "https://open.spotify.com/track/s")
  const noLastfm = await loadTrack(SPOTIFY, musicGet({ lastfm: "down" }).get, "Band", "Song")
  assert.equal(noLastfm.lastfm, null)
  assert.equal(noLastfm.spotify?.url, "https://open.spotify.com/track/s")
})

test("an album or a track Spotify does not know, or with Spotify not set up, has no Spotify part and the rest is there", async () => {
  assert.equal((await loadAlbum(SPOTIFY, musicGet({ missing: true }).get, "Band", "LP")).spotify, null)
  const noSpotify = await loadTrack({ LASTFM_API_KEY: "k", LASTFM_USER: "u" }, musicGet().get, "Band", "Song")
  assert.equal(noSpotify.spotify, null)
  assert.equal(noSpotify.lastfm?.userPlays, 4)
  assert.deepEqual(await loadAlbum({}, musicGet().get, "Band", "LP"), { lastfm: null, spotify: null })
})

test("an answer of Last.fm's that is an error says so, though its status was ok, and nothing else is taken for one", () => {
  assert.equal(lastfmError({ error: 29, message: "Rate Limit Exceeded" }), "Rate Limit Exceeded")
  assert.equal(lastfmError({ error: 27, message: "Deprecated - This type of request is no longer supported" }), "Deprecated - This type of request is no longer supported")
  assert.equal(lastfmError({ track: { name: "x" } }), null)
  assert.equal(lastfmError({ error: "x", message: "y" }), null)
  for (const other of [null, "text", [], 3, undefined]) assert.equal(lastfmError(other), null)
})
