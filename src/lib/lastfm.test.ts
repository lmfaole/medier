import { strict as assert } from "node:assert"
import { test } from "node:test"

import { artistInfoUrl, firstSentences, parseArtistInfo, parseRecentTracks, parseTopArtists } from "./lastfm.ts"

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
  const info = parseArtistInfo({ artist: { tags: { tag: [{ name: "pop" }, { name: "" }, { name: "lgbt" }] }, stats: { listeners: "1234567" }, bio: { summary: BIO } } })
  assert.deepEqual(info.tags, ["pop", "lgbt"])
  assert.equal(info.listeners, 1234567)
  assert.equal(info.bio, "Troye Sivan is an Australian singer and actor. He rose to fame through YouTube. His debut album Blue Neighbourhood came out in 2015 & was a hit.")
  assert.ok(!info.bio?.includes("Read more") && !info.bio?.includes("CC BY-SA"))
})

test("an artist Last.fm knows nothing of has no info, and a bio that is only the link is none", () => {
  assert.deepEqual(parseArtistInfo({ error: 6 }), { tags: [], listeners: null, bio: null })
  assert.equal(parseArtistInfo({ artist: { bio: { summary: '<a href="https://x">Read more on Last.fm</a>' } } }).bio, null)
})

test("a long text is cut at the end of a sentence, never in a word", () => {
  const text = "Første setning er her. Andre setning er også her. Tredje setning kommer til slutt og er lang."
  assert.equal(firstSentences(text, 60), "Første setning er her. Andre setning er også her.")
  assert.equal(firstSentences("ett helt langt ord uten punktum her og der", 20), "ett helt langt ord…")
  assert.equal(firstSentences("kort", 20), "kort")
})

test("the artist is asked for by name, encoded, with autocorrect", () => {
  assert.equal(artistInfoUrl("https://x/?k=1", "Beyoncé & Co"), "https://x/?k=1&method=artist.getinfo&autocorrect=1&artist=Beyonc%C3%A9%20%26%20Co")
})
