import { strict as assert } from "node:assert"
import { test } from "node:test"

import { SHAPES, SPOTIFY_COVER } from "./shapes.ts"

const key = (shape: { ratio: string; corners: string }) => `${shape.ratio}/${shape.corners}`

test("each kind of thing has a shape of its own, so a reader can tell them apart; a person and an artist share the circle, for both are people", () => {
  const distinct = [SHAPES.film, SHAPES.album, SHAPES.track, SHAPES.person].map(key)
  assert.equal(new Set(distinct).size, distinct.length, distinct.join(", "))
  assert.equal(key(SHAPES.artist), key(SHAPES.person))
})

test("a circle is always on a square frame (a poster cannot be one), and Spotify's covers are the album's small corners", () => {
  for (const shape of Object.values(SHAPES)) if (shape.corners === "round") assert.equal(shape.ratio, "square")
  assert.equal(key(SPOTIFY_COVER), key(SHAPES.album))
})
