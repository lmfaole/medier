import { strict as assert } from "node:assert"
import { test } from "node:test"

import { BACKDROP_PATH, backdropPathsIn, tmdbBackdropUrl } from "./backdrop-source.ts"

test("a backdrop is named by a plain file and asked for at TMDB's width", () => {
  assert.equal(BACKDROP_PATH.exec("/backdrops/abc_1-2.jpg")?.[1], "abc_1-2.jpg")
  assert.equal(BACKDROP_PATH.test("/backdrops/../x.jpg"), false)
  assert.deepEqual(backdropPathsIn('{"backdrop":"/backdrops/a.jpg","x":"/backdrops/a.jpg","y":"/backdrops/b.jpg"}'), ["/backdrops/a.jpg", "/backdrops/b.jpg"])
  assert.equal(tmdbBackdropUrl("a.jpg"), "https://image.tmdb.org/t/p/w780/a.jpg")
})
