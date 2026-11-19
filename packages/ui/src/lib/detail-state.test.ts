import { strict as assert } from "node:assert"
import { test } from "node:test"

import { detailOf, pagePath } from "./detail-state.ts"

test("reads the card an old address names", () => {
  assert.deepEqual(detailOf("?kort=film.heat-1995"), { kind: "film", slug: "heat-1995" })
  assert.deepEqual(detailOf(new URLSearchParams("period=2025&kort=person.person-12")), { kind: "person", slug: "person-12" })
})

test("an address without a card has none", () => {
  assert.equal(detailOf(""), undefined)
  assert.equal(detailOf("?period=2025"), undefined)
})

test("a card that is not a kind and a slug is refused, so an edited address cannot reach anything", () => {
  assert.equal(detailOf("?kort=film"), undefined)
  assert.equal(detailOf("?kort=film."), undefined)
  assert.equal(detailOf("?kort=film.../etc"), undefined)
  assert.equal(detailOf("?kort=film.a.b"), undefined)
  assert.equal(detailOf("?kort=Film.Heat"), undefined)
})

test("a thing's page is under its kind, or the Norwegian word a shelf app uses for it", () => {
  assert.equal(pagePath({ kind: "artist", slug: "orville-peck" }), "/artist/orville-peck")
  assert.equal(pagePath({ kind: "game", slug: "hades" }), "/spill/hades")
  assert.equal(pagePath({ kind: "book", slug: "dune" }), "/bok/dune")
  assert.equal(pagePath({ kind: "boardgame", slug: "azul" }), "/brettspill/azul")
})
