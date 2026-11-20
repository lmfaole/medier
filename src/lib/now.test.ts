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
