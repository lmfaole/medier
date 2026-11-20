import { strict as assert } from "node:assert"
import { test } from "node:test"

import { ageOn, longDay } from "./days.ts"

test("a calendar date is written out in Norwegian and no time zone moves it", () => {
  assert.equal(longDay("1940-04-25"), "25. april 1940")
  assert.equal(longDay("2026-01-01"), "1. januar 2026")
})

test("an age is whole years: a day before the birthday is a year less, on it and after it is not", () => {
  assert.equal(ageOn("1940-04-25", "2026-04-24"), 85)
  assert.equal(ageOn("1940-04-25", "2026-04-25"), 86)
  assert.equal(ageOn("1940-04-25", "1994-12-31"), 54)
  assert.equal(ageOn("2026-04-25", "2020-01-01"), null)
  assert.equal(ageOn("junk", "2020-01-01"), null)
})
