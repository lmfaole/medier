import { strict as assert } from "node:assert"
import { test } from "node:test"

import { sourcesOf } from "./image-sources.ts"

test("TMDB and Last.fm addresses become their widths, anything else the one source, nothing none", () => {
  assert.deepEqual(sourcesOf("https://image.tmdb.org/t/p/w185/abc.jpg").map((source) => [source.src, source.width]), [
    ["https://image.tmdb.org/t/p/w92/abc.jpg", 92],
    ["https://image.tmdb.org/t/p/w185/abc.jpg", 185],
    ["https://image.tmdb.org/t/p/w342/abc.jpg", 342],
  ])
  assert.deepEqual(sourcesOf("https://lastfm.freetls.fastly.net/i/u/300x300/x.jpg").map((source) => source.width), [64, 174, 300])
  assert.equal(sourcesOf("https://lastfm.freetls.fastly.net/i/u/300x300/x.jpg")[0]?.src, "https://lastfm.freetls.fastly.net/i/u/64s/x.jpg")
  assert.deepEqual(sourcesOf("https://example.org/a.png"), [{ src: "https://example.org/a.png", width: 300 }])
  assert.deepEqual(sourcesOf(null), [])
})
