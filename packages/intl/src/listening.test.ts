import { strict as assert } from "node:assert"
import { test } from "node:test"

import { formatCount, formatClock, formatHoursAndMinutes, formatSeconds, formatShortDay, formatTimes, formatTimestampDay, formatWholeHours, formatMonthLabel, formatPeriodLabel, longestRun, formatDay, formatMonth, languageName, countryName, requestedChoice, YEAR, peakIndex, MONTH_NAMES, WEEKDAY_NAMES } from "./listening.ts"
import { formatRating, formatRatingOfFive } from "./number.ts"

test("formatPeriodLabel names the all-time period and passes a year through", () => {
  assert.equal(formatPeriodLabel("all"), "Totalt")
  assert.equal(formatPeriodLabel("2025"), "2025")
  assert.equal(formatPeriodLabel("last-30-days"), "Siste 30 dager")
})

test("formatCount groups thousands", () => {
  assert.equal(formatCount(1234567), "1 234 567")
})

test("formatHoursAndMinutes drops whichever part is zero", () => {
  assert.equal(formatHoursAndMinutes(165), "2 t 45 min")
  assert.equal(formatHoursAndMinutes(45), "45 min")
  assert.equal(formatHoursAndMinutes(120), "2 t")
})

test("formatMonthLabel names the month and year without shifting across a timezone", () => {
  assert.equal(formatMonthLabel("2024-03"), "mars 2024")
  assert.equal(formatMonthLabel("2024-01"), "jan. 2024")
})

test("the longest run of days in a row, whatever the order and the repeats", () => {
  assert.equal(longestRun(["2026-03-02", "2026-03-01", "2026-03-01", "2026-03-04", "2026-03-03", "2026-05-01"]), 4)
  assert.equal(longestRun(["2025-12-31", "2026-01-01"]), 2)
  assert.equal(longestRun([]), 0)
})

test("a day, a month, a language and a country read in Norwegian, and a code the platform does not know stays as it is", () => {
  assert.equal(formatDay("2025-08-02"), "2. august 2025")
  assert.equal(formatMonth("2025-03"), "mars 2025")
  assert.equal(languageName("en"), "engelsk")
  assert.equal(languageName("not a code!"), "not a code!")
  assert.equal(countryName("NO"), "Norge")
  assert.equal(countryName("not a code!"), "not a code!")
})

test("a request's choice is taken where they are right and the default otherwise", () => {
  assert.deepEqual([requestedChoice("2025", ["2026", "2025"]), requestedChoice("1999", ["2026", "2025"]), requestedChoice(null, []), requestedChoice("x", [])], ["2025", "2026", "", ""])
})

test("the peak is where the biggest count is, the first on a tie, and the names are in calendar order", () => {
  assert.equal(peakIndex([1, 5, 2, 5]), 1)
  assert.equal(peakIndex([0, 0]), 0)
  assert.deepEqual([MONTH_NAMES.length, MONTH_NAMES[7], WEEKDAY_NAMES.length, WEEKDAY_NAMES[0]], [12, "august", 7, "mandager"])
})

test("lengths, days and counts are written one way in every app", () => {
  assert.equal(formatWholeHours(7380), "123 t")
  assert.deepEqual([formatSeconds(45), formatSeconds(750), formatSeconds(3723)], ["45 s", "12 min", "1 t 2 min"])
  assert.equal(formatShortDay("2025-08-02"), "2. aug. 2025")
  assert.equal(formatClock(Date.UTC(2018, 3, 6, 12, 5) / 1000), "6. apr. 2018, 14:05")
  assert.equal(formatTimes(1686).replace(/\s/g, " "), "1 686×")
})

test("a clock is the day and the time in Oslo, summer and winter, and a timestamp is its UTC day", () => {
  assert.equal(formatClock(Date.UTC(2026, 0, 17, 12, 32) / 1000), "17. jan. 2026, 13:32")
  assert.equal(formatTimestampDay(1523000000), "6. apr. 2018")
})

test("a rating has a decimal comma only where it has a half", () => {
  assert.deepEqual([4, 4.5, 0.5].map(formatRating), ["4", "4,5", "0,5"])
  assert.equal(formatRatingOfFive(4.5), "4,5 av 5")
})

test("a year is four digits", () => {
  assert.ok(YEAR.test("2026") && !YEAR.test("26") && !YEAR.test("2026-03") && !YEAR.test("20261"))
})
