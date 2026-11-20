import { strict as assert } from "node:assert"
import { test } from "node:test"

import { parsePlaying, playingNow, samePlaying } from "./now.ts"

const song = (track: string) => ({ track, artist: "A", album: "B", image: null, url: `https://x/${track}` })

test("Spotify's song is the one playing, and Last.fm's only where Spotify has none", () => {
  assert.equal(playingNow(song("s"), song("l"))?.from, "spotify")
  assert.equal(playingNow(song("s"), song("l"))?.track, "s")
  assert.equal(playingNow(null, song("l"))?.from, "lastfm")
  assert.equal(playingNow(null, null), null)
})

test("a song from Spotify is made a disc only with Last.fm's cover for the same song, never with Spotify's own", () => {
  const withCover = (track: string, image: string | null) => ({ ...song(track), image })
  assert.equal(playingNow(withCover("s", "https://i.scdn.co/a"), withCover("S ", "https://lastfm/a"))?.disc, "https://lastfm/a")
  assert.equal(playingNow(withCover("s", "https://i.scdn.co/a"), withCover("other", "https://lastfm/b"))?.disc, null)
  assert.equal(playingNow(withCover("s", "https://i.scdn.co/a"), null)?.disc, null)
  assert.equal(playingNow(null, withCover("l", "https://lastfm/c"))?.disc, "https://lastfm/c")
})

test("what the endpoint answered is checked: a song with its names, or nothing", () => {
  const body = { track: "Hard", artist: "Rihanna", album: "Rated R", url: "https://x", from: "spotify", image: null, disc: "https://lastfm/a" }
  assert.deepEqual(parsePlaying(body), body)
  assert.equal(parsePlaying(null), null)
  assert.equal(parsePlaying([]), null)
  assert.equal(parsePlaying({ ...body, track: "" }), null)
  assert.equal(parsePlaying({ ...body, from: "tidal" }), null)
  assert.equal(parsePlaying({ ...body, url: 5 }), null)
})

test("the same song with the same covers is the same, and a cover that arrives later is a change", () => {
  const a = { track: "t", artist: "a", album: "b", url: "u", from: "spotify" as const, image: "i", disc: null }
  assert.ok(samePlaying(a, { ...a }))
  assert.ok(!samePlaying(a, { ...a, disc: "https://lastfm/c" }))
  assert.ok(!samePlaying(a, { ...a, track: "other" }))
  assert.ok(!samePlaying(a, null))
  assert.ok(samePlaying(null, null))
})
