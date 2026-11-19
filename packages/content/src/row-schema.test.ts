import { strict as assert } from "node:assert"
import { test } from "node:test"

import { CV_EMPLOYERS, CV_POSITIONS } from "./collections/cv.ts"
import { checked, sortRows } from "./row-schema.ts"

test("a row with a key the collection does not list is an error that names the collection", () => {
  assert.throws(() => checked(CV_EMPLOYERS, { id: 1, extra: 1 }), /cvEmployer does not match its row shape/)
})

test("a row with the wrong type for a field says which field", () => {
  assert.throws(() => checked(CV_POSITIONS, { id: 1, arbeidsgiver_id: 1, fra: null, til: null, aar: "2019", tittel: "t", beskrivelse: null, kortbeskrivelse: null }), /aar/)
})

test("rows come in the collection's order, then by id, numbers as numbers", () => {
  const rows = [{ id: 10 }, { id: 9 }, { id: 2 }]
  assert.deepEqual(sortRows(CV_POSITIONS, rows).map((row) => row["id"]), [2, 9, 10])
})
