import { strict as assert } from "node:assert"
import { test } from "node:test"

import { trendOf, weekTitle } from "./periods.ts"

test("the change is up, down or the same, as a plain percent, and nothing for what cannot be compared", () => {
  assert.deepEqual(trendOf(12), { direction: "up", percent: 12 })
  assert.deepEqual(trendOf(-53), { direction: "down", percent: 53 })
  assert.deepEqual(trendOf(0), { direction: "same", percent: 0 })
  assert.equal(trendOf(null), null)
})

test("a week's title is «Uke» and its number, with the year only when it is not the year of the newest week", () => {
  assert.equal(weekTitle("2026-11-02", 2026), "Uke 45")
  assert.equal(weekTitle("2025-12-22", 2026), "Uke 52 · 2025")
  assert.equal(weekTitle("2025-12-29", 2026), "Uke 1")
})
