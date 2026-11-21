import { strict as assert } from "node:assert"
import { test } from "node:test"

import { type Env, forUsers, type Get, lastfmUserExists, loadAlbum, loadArtist, loadArtistListening, loadArtistPictures, loadLastfmNow, loadMusic, lastfmError, loadPerson, loadTrack, loadWatched, MAX_POSTER_LOOKUPS, settle, traktUserExists, TTL } from "./sources.ts"

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
  assert.equal(await loadLastfmNow({}, get), null)
  assert.deepEqual(asked, [])
})

test("a source with its key but without the visitor's username is left out: nothing is asked for anyone", async () => {
  const { get, asked } = fake({})
  const keys = forUsers(ENV, { lastfm: null, trakt: null })
  assert.equal(await loadMusic(keys, get), null)
  assert.equal(await loadWatched(keys, get), null)
  assert.equal(await loadLastfmNow(keys, get), null)
  assert.deepEqual(asked, [])
})

test("the usernames are the visitor's, threaded into every address, and never the Worker's own", async () => {
  const env = forUsers({ ...ENV, LASTFM_USER: "owner", TRAKT_USER: "owner" }, { lastfm: "visitor", trakt: "seer" })
  const { get, asked } = fake({ "https://ws.audioscrobbler.com/2.0/": RECENT, "https://api.trakt.tv/": [] })
  await Promise.all([loadMusic(env, get), loadWatched(env, get), loadLastfmNow(env, get)])
  assert.ok(asked.filter((one) => one.url.includes("audioscrobbler")).every((one) => one.url.includes("&user=visitor")))
  assert.ok(asked.filter((one) => one.url.includes("trakt")).every((one) => one.url.includes("/users/seer/")))
  assert.ok(asked.every((one) => !one.url.includes("owner")))
  assert.equal(forUsers({ LASTFM_USER: "owner", TRAKT_USER: "owner", LASTFM_API_KEY: "k" }, { lastfm: null, trakt: null })["LASTFM_USER"], undefined)
})

test("a username is checked with the service: Last.fm's error and Trakt's refusal or private profile are not one", async () => {
  const lastfm = (data: unknown): Get => async () => {
    if (lastfmError(data) !== null) throw new Error("ws.audioscrobbler.com: User not found")
    return { data, hit: false }
  }
  assert.equal(await lastfmUserExists(ENV, lastfm({ user: { name: "Ola" } }), "ola"), true)
  assert.equal(await lastfmUserExists(ENV, lastfm({ error: 6, message: "User not found" }), "nobody"), false)
  const trakt = (status: number, data: unknown = {}): Get => async (url) => {
    assert.ok(url.startsWith("https://api.trakt.tv/users/a%20b"))
    if (status !== 200) throw new Error(`api.trakt.tv: ${status}`)
    return { data, hit: false }
  }
  assert.equal(await traktUserExists(ENV, trakt(200, { username: "a b", private: false }), "a b"), true)
  assert.equal(await traktUserExists(ENV, trakt(200, { username: "a b", private: true }), "a b"), false)
  assert.equal(await traktUserExists(ENV, trakt(404), "a b"), false)
  assert.equal(await traktUserExists(ENV, trakt(401), "a b"), false)
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

test("a source that throws is null for settle", async () => {
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

const TOP = { topalbums: { album: [["Hit Song", "9000"], ["Blonde", "5000"], ["Blonde (Deluxe)", "600"], ["Live at Coachella", "700"], ["Endless", "800"]].map(([name, playcount]) => ({ name, playcount, url: "u", image: [] })) } }
const MBID = "a74b1b7f-71a5-4011-9441-d0b5e4122711"
const GROUPS = { "release-groups": ["Blonde", "Endless"].map((title) => ({ id: title, title, "primary-type": "Album", "artist-credit": [{ name: "Frank Ocean", artist: { id: MBID, name: "Frank Ocean" } }] })) }

/** A `get` for an artist's albums: Last.fm's info (with `mbid`) and top albums, and MusicBrainz's answer, or its failure. */
function albumsGet(mbid: string | null, musicbrainz: unknown | Error): { get: Get; asked: { url: string; ttl: number }[] } {
  const asked: { url: string; ttl: number }[] = []
  const get: Get = async (url, request) => {
    asked.push({ url, ttl: request.ttl })
    if (url.includes("method=artist.getinfo")) return { data: { artist: { mbid: mbid ?? "" } }, hit: false }
    if (url.includes("method=artist.gettopalbums")) return { data: TOP, hit: false }
    if (url.startsWith("https://musicbrainz.org/")) {
      if (musicbrainz instanceof Error) throw musicbrainz
      return { data: musicbrainz, hit: false }
    }
    throw new Error(`nothing for ${url}`)
  }
  return { get, asked }
}

test("an artist's albums are only MusicBrainz's albums, asked for by the id Last.fm gives and kept for a week, with Last.fm's plays of all their editions", async () => {
  const { get, asked } = albumsGet(MBID, GROUPS)
  const got = await loadArtist({ LASTFM_API_KEY: "k", LASTFM_USER: "u" }, get, "Frank Ocean")
  assert.deepEqual(got.albums.map((album) => [album.title, album.plays]), [["Blonde", 5600], ["Endless", 800]])
  assert.equal(got.albumsFrom, "musicbrainz")
  const musicbrainz = asked.find((one) => one.url.startsWith("https://musicbrainz.org/"))
  assert.ok(musicbrainz?.url.includes(encodeURIComponent(`arid:${MBID}`)))
  assert.equal(musicbrainz?.ttl, TTL.albums)
})

test("with no MusicBrainz id the albums are asked for by name, and when MusicBrainz fails the titles decide", async () => {
  const byName = albumsGet(null, GROUPS)
  const named = await loadArtist({ LASTFM_API_KEY: "k", LASTFM_USER: "u" }, byName.get, "Frank Ocean")
  assert.ok(byName.asked.some((one) => one.url.includes(encodeURIComponent('artist:"Frank Ocean"'))))
  assert.equal(named.albumsFrom, "musicbrainz")
  const failed = await loadArtist({ LASTFM_API_KEY: "k", LASTFM_USER: "u" }, albumsGet(MBID, new Error("503")).get, "Frank Ocean")
  assert.deepEqual(failed.albums.map((album) => album.title), ["Hit Song", "Blonde", "Endless"])
  assert.equal(failed.albumsFrom, "titles")
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

test("an artist's listening: plays over time (a stretch over kept long, this one briefly), its place and share, its songs, and the artists like it heard too", async () => {
  const now = Date.UTC(2026, 10, 21, 12)
  const asked: { url: string; ttl: number }[] = []
  // Plays in 2025 (from March) and 2026; the chart answers by the range asked.
  const march2025 = Date.UTC(2025, 2, 10) / 1000
  const get: Get = async (url, request) => {
    asked.push({ url, ttl: request.ttl })
    const query = new URL(url).searchParams
    const method = query.get("method")
    if (url.startsWith("https://api.spotify.com/") || url.startsWith("https://accounts.spotify.com/")) throw new Error("no Spotify")
    if (method === "user.getinfo") return { data: { user: { playcount: "10000", registered: { unixtime: String(Date.UTC(2024, 5, 1) / 1000) } } }, hit: false }
    if (method === "user.getweeklyartistchart") {
      const from = Number(query.get("from"))
      const to = Number(query.get("to"))
      const plays = (from <= march2025 && march2025 < to ? 5 : 0) + (from >= Date.UTC(2026, 0, 1) / 1000 - 7200 ? 7 : 0)
      return { data: { weeklyartistchart: { artist: plays === 0 ? [] : [{ name: "A-HA", playcount: String(plays), "@attr": { rank: "1" } }] } }, hit: false }
    }
    if (method === "user.gettopartists") return { data: { topartists: { artist: [{ name: "Sigrid", playcount: "400" }, { name: "a-ha", playcount: "310" }, { name: "Aurora", playcount: "20" }] } }, hit: false }
    if (method === "user.gettoptracks") return { data: { toptracks: { track: [{ name: "Strangers", playcount: "50", artist: { name: "Sigrid" } }, { name: "Take On Me", playcount: "40", artist: { name: "a-ha" } }] } }, hit: false }
    if (method === "artist.getsimilar") return { data: { similarartists: { artist: [{ name: "Morten Harket", match: "1" }, { name: "Aurora", match: "0.4" }] } }, hit: false }
    throw new Error(`nothing for ${url}`)
  }
  const found = await loadArtistListening({ ...ENV, SPOTIFY_CLIENT_ID: "s", SPOTIFY_CLIENT_SECRET: "s", SPOTIFY_REFRESH_TOKEN: "r" }, get, "a-ha", now)
  // From June 2024 to November 2026 is 30 months: quarters, eleven of them (from the second of 2024).
  assert.equal(found?.timeline?.unit, "quarter")
  assert.equal(found?.timeline?.series.length, 11)
  assert.deepEqual(found?.timeline?.series.slice(2, 4), [{ label: "4. kv. 2024", long: "4. kvartal 2024", plays: 0 }, { label: "1. kv. 2025", long: "1. kvartal 2025", plays: 5 }])
  assert.deepEqual(found?.timeline?.series.at(-1), { label: "4. kv. 2026", long: "4. kvartal 2026", plays: 7 })
  assert.deepEqual(found?.place, { rank: 2, plays: 310, share: 0.031 })
  assert.deepEqual(found?.tracks?.map((track) => track.title), ["Take On Me"])
  assert.deepEqual(found?.similar, [{ name: "Aurora", plays: 20, url: "" }])
  // The pictures are the island's to ask for: asked here, after the charts, they found the Worker's limit of questions used up.
  assert.ok(!asked.some((one) => one.url.includes("spotify.com/")))
  const charts = asked.filter((one) => one.url.includes("getweeklyartistchart"))
  assert.equal(charts.find((one) => one.url.includes(`from=${Date.UTC(2024, 3, 1) / 1000 - 7200}&`))?.ttl, TTL.periodDone)
  assert.equal(charts.find((one) => one.url.includes(`from=${Date.UTC(2026, 9, 1) / 1000 - 7200}&`))?.ttl, TTL.periodLive)
  assert.equal(charts.length, 11)
  assert.ok(!asked.some((one) => one.url.includes("method=user.getrecenttracks")))
})

test("an artist's listening leaves out only what failed, and asks nothing without a username", async () => {
  const get: Get = async (url) => {
    if (url.includes("method=user.gettopartists")) return { data: { topartists: { artist: [{ name: "a-ha", playcount: "3" }] } }, hit: false }
    throw new Error("down")
  }
  const found = await loadArtistListening(ENV, get, "a-ha", Date.UTC(2026, 10, 21))
  assert.deepEqual(found, { timeline: null, place: { rank: 1, plays: 3, share: null }, tracks: null, similar: [] })
  assert.equal(await loadArtistListening(forUsers(ENV, { lastfm: null, trakt: null }), get, "a-ha", 0), null)
})
