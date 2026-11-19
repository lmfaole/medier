import { strict as assert } from "node:assert"
import { test } from "node:test"

import { jsonDifference } from "./json-difference.ts"

test("equal values have no difference, whatever the key order", () => {
  assert.equal(jsonDifference({ a: 1, b: [1, { c: null }] }, { b: [1, { c: null }], a: 1 }), null)
})

test("the first difference is named by its path", () => {
  assert.equal(jsonDifference({ a: [1, 2] }, { a: [1, 3] }), ".a[1]: the file has 2, D1 has 3")
  assert.equal(jsonDifference([1, 2], [1]), ": 2 entries in the file, 1 in D1")
  assert.equal(jsonDifference({ a: 1 }, {}), ".a: in the file, missing from D1")
  assert.equal(jsonDifference({}, { b: 1 }), ".b: in D1, missing from the file")
  assert.equal(jsonDifference([], {}), "(root): expected array, found something else")
})
