import { strict as assert } from "node:assert"
import { test } from "node:test"

import { authorize, detailsUrl, parsePoster } from "./tmdb.ts"

test("a film is asked for as a movie and an episode as its show", () => {
  assert.equal(detailsUrl("film", 949), "https://api.themoviedb.org/3/movie/949")
  assert.equal(detailsUrl("episode", 83867), "https://api.themoviedb.org/3/tv/83867")
})

test("a read access token is a bearer and a short key goes in the address", () => {
  assert.deepEqual(authorize("eyJabc", "https://x/y"), { url: "https://x/y", headers: { Authorization: "Bearer eyJabc" } })
  assert.deepEqual(authorize("a b", "https://x/y"), { url: "https://x/y?api_key=a%20b", headers: {} })
})

test("the poster is the image address, and nothing where TMDB has none", () => {
  assert.equal(parsePoster({ poster_path: "/h1.jpg" }), "https://image.tmdb.org/t/p/w185/h1.jpg")
  assert.equal(parsePoster({ poster_path: null }), null)
  assert.equal(parsePoster({ poster_path: "h1.jpg" }), null)
  assert.equal(parsePoster("junk"), null)
})
