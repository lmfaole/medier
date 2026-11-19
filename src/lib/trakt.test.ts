import { strict as assert } from "node:assert"
import { test } from "node:test"

import { episodeCode, mergeHistory, parseHistory } from "./trakt.ts"

const movie = { id: 1, watched_at: "2026-11-18T20:00:00.000Z", type: "movie", movie: { title: "Heat", year: 1995, ids: { slug: "heat-1995" } } }
const episode = {
  id: 2,
  watched_at: "2026-11-19T19:00:00.000Z",
  type: "episode",
  episode: { season: 2, number: 5, title: "Rubicon" },
  show: { title: "Andor", year: 2022, ids: { slug: "andor" } },
}

test("a film and an episode are read with their links to Trakt, and anything else is left out", () => {
  assert.deepEqual(parseHistory([movie, episode, { id: 3, type: "movie" }, "junk"]), [
    { id: 1, watchedAt: "2026-11-18T20:00:00.000Z", kind: "film", title: "Heat", year: 1995, episode: null, url: "https://trakt.tv/movies/heat-1995" },
    { id: 2, watchedAt: "2026-11-19T19:00:00.000Z", kind: "episode", title: "Andor", year: 2022, episode: { title: "Rubicon", season: 2, number: 5 }, url: "https://trakt.tv/shows/andor/seasons/2/episodes/5" },
  ])
  assert.deepEqual(parseHistory({ error: "x" }), [])
})

test("the films and the episodes are one list, newest first, each viewing once", () => {
  const [film, show] = parseHistory([movie, episode])
  assert.ok(film !== undefined && show !== undefined)
  assert.deepEqual(mergeHistory([film], [show, film]).map((watch) => watch.id), [2, 1])
  assert.equal(episodeCode({ season: 2, number: 5 }), "S2 E5")
})
