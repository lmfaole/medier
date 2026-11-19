import { strict as assert } from "node:assert"
import { test } from "node:test"

import { sqliteAsD1 } from "@designsystem/config/sqlite-d1"
import { listensDatabase as database } from "./listens-fixture.ts"
import { MONTHS_SHOWN, months, years } from "./spans.ts"


const NOW = new Date("2026-11-11T12:00:00Z")

test("the months run back across a new year, and no year comes before the first listen", async () => {
  const sqlite = database([["2024-12-31T23:59:00", "A"]])
  const january = (await months(sqliteAsD1(sqlite), new Date("2026-01-31T23:59:59Z"))).months
  assert.deepEqual(january.slice(0, 3).map((month) => month.start), ["2026-01-01", "2025-12-01", "2025-11-01"])
  assert.deepEqual((await years(sqliteAsD1(sqlite), new Date("2024-12-31T23:59:59Z"))).years.map((year) => year.start), ["2024-01-01"])
  assert.deepEqual((await years(sqliteAsD1(sqlite), NOW)).years.map((year) => year.start), ["2026-01-01", "2025-01-01", "2024-01-01"])
})

test("the monthly summary has the months newest first, the artists that led and the change from the month before", async () => {
  const sqlite = database([
    ["2026-11-01T00:00:00", "Caribou"], ["2026-11-10T08:00:00", "Caribou"], ["2026-11-11T08:00:00", "Röyksopp"],
    ["2026-10-01T00:00:00", "Caribou"], ["2026-10-31T23:59:00", "Bonobo"], ["2026-10-15T08:00:00", "Bonobo"], ["2026-10-16T08:00:00", "Röyksopp"],
    ["2026-08-20T10:00:00", "Röyksopp"],
  ])
  const { months: result } = await months(sqliteAsD1(sqlite), NOW)
  assert.equal(result.length, MONTHS_SHOWN)
  assert.deepEqual(result.map((month) => month.start).slice(0, 4), ["2026-11-01", "2026-10-01", "2026-09-01", "2026-08-01"])
  assert.deepEqual([result[0]?.plays, result[0]?.change, result[0]?.ongoing], [3, null, true])
  assert.deepEqual(result[0]?.topArtists, [{ artist: "Caribou", plays: 2 }, { artist: "Röyksopp", plays: 1 }])
  assert.deepEqual([result[1]?.plays, result[1]?.change, result[1]?.ongoing], [4, null, false])
  assert.deepEqual(result[1]?.topArtists[0], { artist: "Bonobo", plays: 2 })
  assert.deepEqual([result[2]?.plays, result[2]?.change], [0, -100])
  assert.deepEqual([result[3]?.plays, result[3]?.change], [1, null])
})

test("the yearly summary has every year since the first listen, and compares each with the year before", async () => {
  const sqlite = database([
    ["2024-12-31T23:59:00", "A"], ["2024-06-01T00:00:00", "A"],
    ["2026-01-01T00:00:00", "B"], ["2026-03-01T00:00:00", "B"], ["2026-03-02T00:00:00", "A"],
  ])
  const { years: result } = await years(sqliteAsD1(sqlite), NOW)
  assert.deepEqual(result.map((year) => [year.start, year.plays, year.change, year.ongoing]), [
    ["2026-01-01", 3, null, true],
    ["2025-01-01", 0, -100, false],
    ["2024-01-01", 2, null, false],
  ])
  assert.deepEqual(result[0]?.topArtists, [{ artist: "B", plays: 2 }, { artist: "A", plays: 1 }])
})

test("a year compared with the year before it, and no years at all for no listens", async () => {
  const sqlite = database([["2025-02-01T00:00:00", "A"], ["2025-02-02T00:00:00", "A"], ["2025-02-03T00:00:00", "A"], ["2025-02-04T00:00:00", "A"], ["2024-02-01T00:00:00", "A"], ["2024-02-02T00:00:00", "A"]])
  assert.equal((await years(sqliteAsD1(sqlite), NOW)).years[1]?.change, 100)
  assert.deepEqual((await years(sqliteAsD1(database([])), NOW)).years, [])
  assert.ok((await months(sqliteAsD1(database([])), NOW)).months.every((month) => month.plays === 0 && month.change === null))
})
