import { strict as assert } from "node:assert"
import { test } from "node:test"

import { UNKNOWN_TIME, formatTime, osloDay, timeStamp, isoWeek } from "./time.ts"

const WHEN = "2026-11-11T06:55:04.667Z"

test("every style is written in Norwegian, in Oslo", () => {
  assert.equal(formatTime(WHEN), "11. november 2026 kl. 07:55")
  assert.equal(formatTime(WHEN, "compact"), "11. nov. 2026, 07:55")
  assert.equal(formatTime(WHEN, "date"), "11. november 2026")
  assert.equal(formatTime(WHEN, "day"), "11. nov.")
  assert.equal(formatTime(WHEN, "weekday"), "onsdag")
  assert.equal(formatTime(WHEN, "weekdayDate"), "onsdag 11. november 2026")
  assert.equal(formatTime(WHEN, "clock"), "07:55")
})

test("summer time, and a Date or epoch milliseconds, give the same text", () => {
  assert.equal(formatTime("2026-07-01T10:00:00Z", "clock"), "12:00")
  assert.equal(formatTime(new Date(WHEN)), formatTime(Date.parse(WHEN)))
})

test("a plain day is a calendar day: no time zone moves it, and it has no clock", () => {
  assert.equal(formatTime("2026-11-05", "day"), "5. nov.")
  assert.equal(formatTime("2026-11-05", "weekday"), "torsdag")
  assert.equal(formatTime("2026-11-05"), "5. november 2026")
})

test("what is no time reads «ukjent tid», never a raw string or Invalid Date", () => {
  for (const value of ["", "i går", "2026-13-45", null, undefined, Number.NaN]) assert.equal(formatTime(value), UNKNOWN_TIME, String(value))
})

test("the machine-readable form, and the Oslo day", () => {
  assert.equal(timeStamp(WHEN), WHEN)
  assert.equal(timeStamp("2026-11-05"), "2026-11-05")
  assert.equal(timeStamp("nope"), null)
  assert.equal(osloDay("2026-11-10T23:30:00Z"), "2026-11-11")
})

test("a time ago is written in words", async () => {
  const { formatSince } = await import("./time.ts")
  const now = new Date(WHEN)
  const ago = (seconds: number) => formatSince(new Date(now.getTime() - seconds * 1000), now)
  assert.deepEqual([0, 120, 3 * 3600, 25 * 3600].map(ago), ["nå", "for 2 minutter siden", "for 3 timer siden", "i går"])
  assert.equal(formatSince("nope", now), UNKNOWN_TIME)
})

test("a week is numbered by ISO 8601 from its Monday, and the week of New Year belongs to the year its Thursday is in", () => {
  assert.deepEqual(isoWeek("2026-11-09"), { week: 46, year: 2026 })
  assert.deepEqual(isoWeek("2026-11-02"), { week: 45, year: 2026 })
  assert.deepEqual(isoWeek("2026-10-26"), { week: 44, year: 2026 })
  assert.deepEqual(isoWeek("2025-12-29"), { week: 1, year: 2026 })
  assert.deepEqual(isoWeek("2024-12-30"), { week: 1, year: 2025 })
  assert.deepEqual(isoWeek("2020-12-28"), { week: 53, year: 2020 })
  assert.deepEqual(isoWeek("2021-01-04"), { week: 1, year: 2021 })
})
