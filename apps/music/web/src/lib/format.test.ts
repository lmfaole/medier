import { strict as assert } from "node:assert"
import { test } from "node:test"

import { formatHourLabel, formatShare } from "./format.ts"

test("formatHourLabel zero-pads every hour of the day", () => {
  assert.equal(formatHourLabel(0), "00")
  assert.equal(formatHourLabel(9), "09")
  assert.equal(formatHourLabel(23), "23")
})

test("formatShare rounds to a whole percentage and survives an empty whole", () => {
  assert.equal(formatShare(874, 1000), "87 %")
  assert.equal(formatShare(1000, 1000), "100 %")
  assert.equal(formatShare(0, 0), "0 %")
})
