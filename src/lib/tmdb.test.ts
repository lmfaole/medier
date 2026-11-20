import { strict as assert } from "node:assert"
import { test } from "node:test"

import { authorize, detailsUrl, parseInfo, parsePoster } from "./tmdb.ts"

test("a film is asked for as a movie and an episode as its show", () => {
  assert.equal(detailsUrl("film", 949), "https://api.themoviedb.org/3/movie/949?language=nb-NO")
  assert.equal(detailsUrl("episode", 83867), "https://api.themoviedb.org/3/tv/83867?language=nb-NO")
})

test("a read access token is a bearer and a short key goes in the address", () => {
  assert.deepEqual(authorize("eyJabc", "https://x/y"), { url: "https://x/y", headers: { Authorization: "Bearer eyJabc" } })
  assert.deepEqual(authorize("a b", "https://x/y"), { url: "https://x/y?api_key=a%20b", headers: {} })
  assert.equal(authorize("k", "https://x/y?language=nb-NO").url, "https://x/y?language=nb-NO&api_key=k")
})

test("the poster is the image address, and nothing where TMDB has none", () => {
  assert.equal(parsePoster({ poster_path: "/h1.jpg" }), "https://image.tmdb.org/t/p/w185/h1.jpg")
  assert.equal(parsePoster({ poster_path: null }), null)
  assert.equal(parsePoster({ poster_path: "h1.jpg" }), null)
  assert.equal(parsePoster("junk"), null)
})

test("a film's info is its plot, genres, length and vote; a show has seasons instead of a length", () => {
  const film = parseInfo({ overview: " Et ran. ", genres: [{ name: "Krim" }, { name: "" }, "junk"], runtime: 170, vote_average: 7.9, vote_count: 12000 })
  assert.deepEqual(film, { overview: "Et ran.", genres: ["Krim"], runtime: 170, seasons: null, rating: { value: 7.9, votes: 12000 } })
  assert.equal(parseInfo({ number_of_seasons: 2 }).seasons, 2)
})

test("what TMDB has not got is null, not zero or an empty line, and a vote nobody gave is no rating", () => {
  assert.deepEqual(parseInfo({ overview: "", runtime: 0, vote_average: 0, vote_count: 0 }), { overview: null, genres: [], runtime: null, seasons: null, rating: null })
  assert.equal(parseInfo({ vote_average: 8, vote_count: 0 }).rating, null)
  assert.deepEqual(parseInfo("junk"), { overview: null, genres: [], runtime: null, seasons: null, rating: null })
})
