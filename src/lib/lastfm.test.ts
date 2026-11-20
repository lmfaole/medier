import { strict as assert } from "node:assert"
import { test } from "node:test"

import { albumInfoUrl, artistChartUrl, artistInfoUrl, artistPlaysBeforeUrl, parseArtistChart, parseArtistPlays, parseRecentPage, playsInRangeUrl, firstSentences, parseAlbumInfo, parseArtistInfo, parseRecentTracks, parseTopArtists, parseTrackInfo, trackInfoUrl } from "./lastfm.ts"

test("recent tracks: a played one has its time, the one playing now has none, an empty cover is null and a broken row is left out", () => {
  const plays = parseRecentTracks({
    recenttracks: {
      track: [
        { name: "Now", artist: { "#text": "A" }, album: { "#text": "X" }, image: [{ size: "small", "#text": "" }], url: "u0", "@attr": { nowplaying: "true" } },
        { name: "Then", artist: { "#text": "B" }, album: { "#text": "Y" }, image: [{ "#text": "s.jpg" }, { "#text": "l.jpg" }], url: "u1", date: { uts: "1763560800" } },
        { name: "", artist: { "#text": "C" } },
      ],
    },
  })
  assert.deepEqual(plays, [
    { track: "Now", artist: "A", album: "X", image: null, url: "u0", playedAt: null },
    { track: "Then", artist: "B", album: "Y", image: "l.jpg", url: "u1", playedAt: "2025-11-19T14:00:00.000Z" },
  ])
})

test("a single track comes as an object, not a list, and is read all the same; nothing at all is no plays", () => {
  assert.equal(parseRecentTracks({ recenttracks: { track: { name: "One", artist: { "#text": "A" }, date: { uts: "1" } } } }).length, 1)
  assert.deepEqual(parseRecentTracks({}), [])
})

test("top artists have their plays as numbers", () => {
  assert.deepEqual(parseTopArtists({ topartists: { artist: [{ name: "A", playcount: "42", url: "a" }, { name: "" }] } }), [{ name: "A", plays: 42, url: "a" }])
})

const BIO = "Troye Sivan is an Australian singer and actor. He rose to fame through YouTube. His debut album Blue Neighbourhood came out in 2015 &amp; was a hit. <a href=\"https://www.last.fm/music/Troye+Sivan\">Read more on Last.fm</a>. User-contributed text is available under the CC BY-SA License."

test("an artist's info is its tags, its listeners and the text before Last.fm's own link and licence line, as plain text", () => {
  const info = parseArtistInfo({ artist: { tags: { tag: [{ name: "pop" }, { name: "" }, { name: "lgbt" }] }, stats: { listeners: "1234567", userplaycount: "88" }, bio: { summary: BIO } } })
  assert.deepEqual(info.tags, ["pop", "lgbt"])
  assert.equal(info.listeners, 1234567)
  assert.equal(info.userPlays, 88)
  assert.equal(info.bio, "Troye Sivan is an Australian singer and actor. He rose to fame through YouTube. His debut album Blue Neighbourhood came out in 2015 & was a hit.")
  assert.ok(!info.bio?.includes("Read more") && !info.bio?.includes("CC BY-SA"))
})

test("an artist Last.fm knows nothing of has no info, and a bio that is only the link is none", () => {
  assert.deepEqual(parseArtistInfo({ error: 6 }), { tags: [], listeners: null, userPlays: null, bio: null })
  assert.equal(parseArtistInfo({ artist: { bio: { summary: '<a href="https://x">Read more on Last.fm</a>' } } }).bio, null)
})

test("a long text is cut at the end of a sentence, never in a word", () => {
  const text = "Første setning er her. Andre setning er også her. Tredje setning kommer til slutt og er lang."
  assert.equal(firstSentences(text, 60), "Første setning er her. Andre setning er også her.")
  assert.equal(firstSentences("ett helt langt ord uten punktum her og der", 20), "ett helt langt ord…")
  assert.equal(firstSentences("kort", 20), "kort")
})

test("the artist is asked for by name, encoded, with autocorrect", () => {
  assert.equal(artistInfoUrl("https://x/?k=1", "Beyoncé & Co", "me"), "https://x/?k=1&method=artist.getinfo&autocorrect=1&artist=Beyonc%C3%A9%20%26%20Co&username=me")
})

test("a track's info is its tags, listeners, the owner's own count, its length in seconds and Last.fm's text where there is one", () => {
  const info = parseTrackInfo({ track: { duration: "215000", listeners: "5000", userplaycount: "12", toptags: { tag: [{ name: "pop" }] }, wiki: { summary: `${BIO.slice(0, 120)} <a href="x">Read more</a>` } } })
  assert.equal(info.seconds, 215)
  assert.equal(info.listeners, 5000)
  assert.equal(info.userPlays, 12)
  assert.deepEqual(info.tags, ["pop"])
  assert.ok(info.bio?.startsWith("Troye Sivan is"))
  assert.deepEqual(parseTrackInfo({ error: 6 }), { tags: [], listeners: null, userPlays: null, seconds: null, bio: null })
  assert.equal(parseTrackInfo({ track: { duration: "0", userplaycount: "0" } }).seconds, null)
})

test("an album's info has its tracks in order, one track is a list of one, and a track without a name is left out", () => {
  const many = parseAlbumInfo({ album: { listeners: "9", userplaycount: "3", tracks: { track: [{ name: "One", duration: "180" }, { name: "" }, { name: "Two", duration: "0" }] } } })
  assert.deepEqual(many.tracks, [{ title: "One", seconds: 180 }, { title: "Two", seconds: null }])
  assert.equal(many.userPlays, 3)
  assert.deepEqual(parseAlbumInfo({ album: { tracks: { track: { name: "Only", duration: "60" } } } }).tracks, [{ title: "Only", seconds: 60 }])
  assert.deepEqual(parseAlbumInfo(null), { tags: [], listeners: null, userPlays: null, bio: null, tracks: [] })
})

test("a track and an album are asked for by artist and name, encoded, with the owner's name for the count", () => {
  assert.equal(trackInfoUrl("https://x/?k=1", "A & B", "Why?", "me"), "https://x/?k=1&method=track.getinfo&autocorrect=1&artist=A%20%26%20B&track=Why%3F&username=me")
  assert.equal(albumInfoUrl("https://x/?k=1", "A", "LP", "me"), "https://x/?k=1&method=album.getinfo&autocorrect=1&artist=A&album=LP&username=me")
})

test("a page of a range's plays has where it is among the pages and how many there are in all, and what plays this moment is not one of them", () => {
  const page = parseRecentPage({ recenttracks: { "@attr": { page: "2", totalPages: "5", total: "913" }, track: [
    { name: "Now", artist: { "#text": "A" }, "@attr": { nowplaying: "true" } },
    { name: "Then", artist: { "#text": "B" }, album: { "#text": "X" }, url: "u", date: { uts: "1763560800" } },
  ] } })
  assert.deepEqual([page.page, page.totalPages, page.total], [2, 5, 913])
  assert.deepEqual(page.plays.map((play) => play.track), ["Then"])
  assert.deepEqual(parseRecentPage({}), { plays: [], page: 1, totalPages: 1, total: 0 })
})

test("a week's chart has each artist's plays and place; one with no name or no count is left out", () => {
  const chart = parseArtistChart({ weeklyartistchart: { artist: [{ name: "A", playcount: "41", "@attr": { rank: "1" } }, { name: "", playcount: "3" }, { name: "B", playcount: "x" }, { name: "C", playcount: "7", "@attr": { rank: "2" } }] } })
  assert.deepEqual(chart, [{ name: "A", plays: 41, rank: 1 }, { name: "C", plays: 7, rank: 2 }])
  assert.deepEqual(parseArtistChart(null), [])
})

test("the plays of an artist before a moment are its total, nothing is zero, and an answer without one is not known", () => {
  assert.equal(parseArtistPlays({ artisttracks: { "@attr": { total: "12" } } }), 12)
  assert.equal(parseArtistPlays({ artisttracks: { "@attr": { total: "0" } } }), 0)
  assert.equal(parseArtistPlays({ error: 6 }), null)
  assert.equal(parseArtistPlays({ artisttracks: { "@attr": {} } }), null)
})

test("a range is asked for by unix seconds with the end left out, a chart by both ends, and the plays before a moment by the second before it", () => {
  assert.equal(playsInRangeUrl("https://x/?k=1", 100, 200, 3), "https://x/?k=1&method=user.getrecenttracks&from=100&to=199&limit=200&page=3")
  assert.equal(artistChartUrl("https://x/?k=1", 100, 200), "https://x/?k=1&method=user.getweeklyartistchart&from=100&to=200")
  assert.equal(artistPlaysBeforeUrl("https://x/?k=1", "Beyoncé", 100), "https://x/?k=1&method=user.getartisttracks&artist=Beyonc%C3%A9&endTimestamp=99&limit=1")
})
