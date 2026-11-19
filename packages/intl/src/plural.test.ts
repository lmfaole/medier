import { strict as assert } from "node:assert"
import { test } from "node:test"

import { pluralize } from "./plural.ts"

test("pluralize picks 'one' or 'other' and formats the count for the locale", () => {
  const forms = { one: "{count} konto", other: "{count} kontoer" }
  assert.equal(pluralize(1, forms, "nb-NO"), "1 konto")
  assert.equal(pluralize(0, forms, "nb-NO"), "0 kontoer")
  assert.equal(pluralize(1500, forms, "nb-NO"), "1 500 kontoer")
})

test("pluralize uses the 'few' and 'many' categories for a locale that has them", () => {
  const forms = { one: "{count} plik", few: "{count} pliki", many: "{count} plików", other: "{count} pliku" }
  assert.equal(pluralize(1, forms, "pl"), "1 plik")
  assert.equal(pluralize(3, forms, "pl"), "3 pliki")
  assert.equal(pluralize(5, forms, "pl"), "5 plików")
})

test("pluralize falls back to 'other' when the selected category has no form", () => {
  assert.equal(pluralize(1, { other: "{count} items" }, "en-US"), "1 items")
})

test("pluralize honours ordinal rules", () => {
  const forms = { one: "{count}st", two: "{count}nd", few: "{count}rd", other: "{count}th" }
  assert.equal(pluralize(1, forms, "en-US", { type: "ordinal" }), "1st")
  assert.equal(pluralize(22, forms, "en-US", { type: "ordinal" }), "22nd")
  assert.equal(pluralize(13, forms, "en-US", { type: "ordinal" }), "13th")
})
