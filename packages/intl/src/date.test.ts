import { strict as assert } from "node:assert"
import { test } from "node:test"

import { formatDate, formatRelativeDate } from "./date.ts"

test("formatDate accepts a Date or an ISO string and honours locale and options", () => {
  const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }
  assert.equal(formatDate("2024-03-05T00:00:00Z", "nb-NO", options), "5. mars 2024")
  assert.equal(formatDate(new Date("2024-03-05T00:00:00Z"), "en-US", options), "March 5, 2024")
})

const now = new Date("2024-06-15T12:00:00Z")

test("formatRelativeDate picks the coarsest unit that rounds to at least one", () => {
  assert.equal(formatRelativeDate("2024-06-15T09:00:00Z", "en-US", now), "3 hours ago")
  assert.equal(formatRelativeDate("2024-06-12T12:00:00Z", "en-US", now), "3 days ago")
  assert.equal(formatRelativeDate("2022-06-15T12:00:00Z", "en-US", now), "2 years ago")
  assert.equal(formatRelativeDate("2024-06-15T14:00:00Z", "en-US", now), "in 2 hours")
})

test("formatRelativeDate says 'yesterday' rather than '25 hours ago'", () => {
  assert.equal(formatRelativeDate("2024-06-14T11:00:00Z", "en-US", now), "yesterday")
  assert.equal(formatRelativeDate("2024-06-14T11:00:00Z", "nb-NO", now), "i går")
})

test("formatRelativeDate reports an identical moment in seconds", () => {
  assert.equal(formatRelativeDate(now, "en-US", now), "now")
})
