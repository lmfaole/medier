import { strict as assert } from "node:assert"
import { test } from "node:test"

import { parseRecentTracks, parseTopArtists } from "./lastfm.ts"

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
