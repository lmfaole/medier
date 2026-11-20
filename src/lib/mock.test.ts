import { strict as assert } from "node:assert"
import { test } from "node:test"

import { artistChartUrl, artistInfoUrl, artistTopAlbumsUrl, albumInfoUrl, parseAlbumInfo, parseArtistChart, parseArtistInfo, parseRecentPage, parseRecentTracks, parseTopAlbums, parseTopArtists, parseTrackInfo, playsInRangeUrl, playsTotalUrl, trackInfoUrl } from "./lastfm.ts"
import { MOCK_ARTISTS, mockFetch, mockSettings } from "./mock.ts"
import { parseAlbumMatch, parseArtistMatch, parseToken, parseTrackMatch, refreshRequest, searchAlbumUrl, searchArtistUrl, searchTrackUrl } from "./spotify.ts"
import { authorize, detailsUrl, parseInfo, parsePerson, parsePoster, personUrl } from "./tmdb.ts"
import { parseHistory } from "./trakt.ts"

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0)
const SECONDS = NOW / 1000
const DAY = 86400
const newest = MOCK_ARTISTS.at(-1)
const BASE = "https://ws.audioscrobbler.com/2.0/?format=json&api_key=mock&user=ola"
const ask = async (url: string, request: Parameters<typeof mockFetch>[1] = {}): Promise<unknown> => mockFetch(url, request, NOW).json()

test("Last.fm: the recent plays, the top artists and the charts are read by the site's own parsers", async () => {
  const recent = parseRecentTracks(await ask(`${BASE}&method=user.getrecenttracks&limit=50`))
  assert.equal(recent[0]?.playedAt, null)
  assert.equal(recent.filter((play) => play.playedAt !== null).length, 50)
  assert.ok(recent.every((play) => /^\/mock\/cover-\d+-\d+\.(jpg|png)$/.test(play.image ?? "")))
  assert.ok(parseTopArtists(await ask(`${BASE}&method=user.gettopartists&period=1month&limit=10`)).length > 3)

  const week = parseRecentPage(await ask(playsInRangeUrl(BASE, SECONDS - 7 * DAY, SECONDS, 1)))
  assert.ok(week.total > 50 && week.plays.length > 0 && week.plays.every((play) => Date.parse(play.playedAt ?? "") >= (SECONDS - 7 * DAY) * 1000))
  assert.equal(parseRecentPage(await ask(playsTotalUrl(BASE, SECONDS - 7 * DAY, SECONDS))).total, week.total)
  const month = parseRecentPage(await ask(playsInRangeUrl(BASE, SECONDS - 30 * DAY, SECONDS, 1)))
  assert.ok(month.totalPages > 1 && month.page === 1)

  const before = parseArtistChart(await ask(artistChartUrl(BASE, 0, SECONDS - 30 * DAY)))
  assert.ok(before.length >= 6 && !before.some((artist) => artist.name === newest))
  assert.ok(parseArtistChart(await ask(artistChartUrl(BASE, SECONDS - 7 * DAY, SECONDS))).some((artist) => artist.name === newest))
})

test("Last.fm: info for an artist, an album and a track; an unknown name is Last.fm's own error", async () => {
  const name = MOCK_ARTISTS[0] ?? ""
  const artist = parseArtistInfo(await ask(artistInfoUrl(BASE, name, "ola")))
  assert.ok(artist.tags.length > 0 && (artist.userPlays ?? 0) > 0 && artist.bio !== null)
  const albums = parseTopAlbums(await ask(artistTopAlbumsUrl(BASE, name)))
  assert.equal(albums.length, 2)
  const album = parseAlbumInfo(await ask(albumInfoUrl(BASE, name, albums[0]?.title ?? "", "ola")))
  assert.ok(album.tracks.length > 0 && album.bio !== null)
  const track = parseTrackInfo(await ask(trackInfoUrl(BASE, name, album.tracks[0]?.title ?? "", "ola")))
  assert.ok((track.seconds ?? 0) > 100)
  assert.deepEqual(await ask(artistInfoUrl(BASE, "Finnes ikke", "ola")), { error: 6, message: "The artist you supplied could not be found" })
})

test("Trakt and TMDB: history in a range, then each title's poster, facts, credits and each person", async () => {
  const range = `start_at=${encodeURIComponent(new Date(NOW - 30 * DAY * 1000).toISOString())}&end_at=${encodeURIComponent(new Date(NOW).toISOString())}&limit=100&page=1`
  const films = parseHistory(await ask(`https://api.trakt.tv/users/ola/history/movies?${range}`))
  const episodes = parseHistory(await ask(`https://api.trakt.tv/users/ola/history/episodes?${range}`))
  assert.ok(films.length > 0 && episodes.length > 0 && episodes.every((watch) => watch.episode !== null))
  assert.ok(parseHistory(await ask("https://api.trakt.tv/users/ola/history/movies?limit=50")).length > 0)

  const film = films[0]
  const request = authorize("mock", detailsUrl("film", film?.tmdbId ?? 0))
  const answer = await ask(request.url)
  const info = parseInfo(answer)
  assert.ok(parsePoster(answer)?.startsWith("/mock/") && info.overview !== null && info.cast.length === 5 && info.crew.some((one) => one.role === "Regi"))
  assert.ok(parseInfo(await ask(detailsUrl("episode", episodes[0]?.tmdbId ?? 0))).seasons !== null)

  const person = parsePerson(await ask(personUrl(info.cast[0]?.id ?? 0)))
  assert.ok(person?.biography !== null && person?.department === "Skuespiller")
})

test("Spotify: the token, and the searches that find an artist, an album and a track by name", async () => {
  const request = refreshRequest("mock", "mock", "mock")
  assert.equal(parseToken(await ask(request.url, request))?.accessToken, "mock-access-token")

  const name = MOCK_ARTISTS[2] ?? ""
  assert.ok((parseArtistMatch(await ask(searchArtistUrl(name)), name)?.images.length ?? 0) > 0)
  const albums = parseTopAlbums(await ask(artistTopAlbumsUrl(BASE, name)))
  const album = albums[0]?.title ?? ""
  const tracks = parseAlbumInfo(await ask(albumInfoUrl(BASE, name, album, "ola"))).tracks
  assert.equal(parseAlbumMatch(await ask(searchAlbumUrl(album, name)), album, name)?.tracks, tracks.length)
  const first = tracks[0]?.title ?? ""
  assert.ok(parseTrackMatch(await ask(searchTrackUrl(first, name)), first, name) !== null)
  assert.equal(parseArtistMatch(await ask(searchArtistUrl("Ukjent")), "Ukjent"), null)
})

test("an address that is none of the sources' is 404, and made-up settings give every source a key without overriding one, and no username (the visitor gives it)", () => {
  assert.equal(mockFetch("https://example.com/", {}, NOW).status, 404)
  assert.equal(mockSettings({ LASTFM_API_KEY: "meg", TMDB_API_KEY: "x" })["LASTFM_API_KEY"], "meg")
  assert.equal(mockSettings({})["LASTFM_USER"], undefined)
  assert.equal(mockSettings({})["TRAKT_CLIENT_ID"], "mock")
})
