import { strict as assert } from "node:assert"
import { test } from "node:test"

import { playingNow } from "./now.ts"

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
