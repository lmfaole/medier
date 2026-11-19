import { strict as assert } from "node:assert"
import { test } from "node:test"

import * as v from "valibot"

import { LibrarySearch, librarySearchQuery, matchesQuery } from "./library-search.ts"

test("a search keeps what it understands and drops the rest, so a hand-edited address cannot break the page", () => {
  assert.deepEqual(v.parse(LibrarySearch, { q: "  Hades ", format: "vinyl", status: "done" }), { q: "Hades", format: "vinyl", status: "done" })
  assert.deepEqual(v.parse(LibrarySearch, { q: "", status: "tapt", format: 3 }), { q: undefined, status: undefined, format: undefined })
})

test("a query matches when every word of it is in the text, however the text is written", () => {
  assert.equal(matchesQuery("Sult (1966)", "sult"), true)
  assert.equal(matchesQuery("Så Vidt!", "sa vidt"), true)
  assert.equal(matchesQuery("Hades", "hades celeste"), false)
  assert.equal(matchesQuery("Hades", undefined), true)
})

test("a search is written back as the query string it was read from", () => {
  assert.equal(librarySearchQuery({ q: "Hades celeste", status: "done", kind: undefined, format: undefined }), "?q=Hades+celeste&status=done")
  assert.equal(librarySearchQuery(v.parse(LibrarySearch, {})), "")
})
