import { strict as assert } from "node:assert"
import { test } from "node:test"

import { CINEMA_IMAGE_PATH, cinemaImagePath, cinemaImagePathsIn } from "./cinema-image.ts"

test("a picture's path follows from its address and is a plain file name", () => {
  const path = cinemaImagePath("https://example.com/a/b.jpg?w=1800")
  assert.match(path ?? "", CINEMA_IMAGE_PATH)
  assert.equal(path, cinemaImagePath("https://example.com/a/b.jpg?w=1800"))
  assert.notEqual(path, cinemaImagePath("https://example.com/a/c.jpg"))
  assert.match(cinemaImagePath("https://example.com/x.png") ?? "", /\.png$/)
  assert.equal(cinemaImagePath("javascript:alert(1)"), null)
  assert.equal(CINEMA_IMAGE_PATH.test("/cinemas/../x.jpg"), false)
})

test("the paths a text names are found once each", () => {
  assert.deepEqual(cinemaImagePathsIn('{"a":"/cinemas/ab12.jpg","b":"/cinemas/ab12.jpg","c":"/cinemas/cd34.png"}'), ["/cinemas/ab12.jpg", "/cinemas/cd34.png"])
})
