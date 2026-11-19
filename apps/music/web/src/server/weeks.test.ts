import { strict as assert } from "node:assert"
import { test } from "node:test"

import { sqliteAsD1 } from "@designsystem/config/sqlite-d1"
import { listensDatabase as database } from "./listens-fixture.ts"
import { WEEKS_SHOWN, weeks } from "./api.ts"


// A Wednesday: the week it is in starts on Monday the 9th.
const NOW = new Date("2026-11-11T12:00:00Z")

test("the weekly summary has the weeks newest first, with the plays of each, the artists that led and how the plays differ from the week before", async () => {
  const sqlite = database([
    ["2026-11-09T08:00:00", "Caribou"], ["2026-11-10T08:00:00", "Caribou"], ["2026-11-11T08:00:00", "Röyksopp"],
    ["2026-11-02T08:00:00", "Caribou"], ["2026-11-03T08:00:00", "Caribou"], ["2026-11-04T08:00:00", "Bonobo"], ["2026-11-08T23:59:00", "Röyksopp"],
    ["2026-10-26T00:00:00", "Bonobo"], ["2026-11-01T23:00:00", "Bonobo"],
    ["2026-10-12T10:00:00", "Röyksopp"],
  ])
  const { weeks: result } = await weeks(sqliteAsD1(sqlite), NOW)
  assert.equal(result.length, WEEKS_SHOWN)
  assert.deepEqual(result.map((week) => week.start).slice(0, 4), ["2026-11-09", "2026-11-02", "2026-10-26", "2026-10-19"])
  // the week that is not over: its plays so far, and no change
  assert.deepEqual([result[0]?.plays, result[0]?.change, result[0]?.ongoing], [3, null, true])
  assert.deepEqual(result[0]?.topArtists, [{ artist: "Caribou", plays: 2 }, { artist: "Röyksopp", plays: 1 }])
  // twice the plays of the week before; a tie goes to the artist who comes first
  assert.deepEqual([result[1]?.plays, result[1]?.change, result[1]?.ongoing], [4, 100, false])
  assert.deepEqual(result[1]?.topArtists, [{ artist: "Caribou", plays: 2 }, { artist: "Bonobo", plays: 1 }, { artist: "Röyksopp", plays: 1 }])
  // Sunday evening is in the week it ends: Monday 26 October to Sunday 1 November
  assert.deepEqual([result[2]?.plays, result[2]?.change], [2, null])
  // a week with nothing is a week with nothing, a hundred percent fewer than the week before it
  assert.deepEqual([result[3]?.plays, result[3]?.change, result[3]?.topArtists], [0, -100, []])
  assert.equal(result[4]?.plays, 1)
})

test("a week is compared with the one before it, and at most three artists are named", async () => {
  const sqlite = database([
    ["2026-11-02T08:00:00", "A"], ["2026-11-02T09:00:00", "A"], ["2026-11-02T10:00:00", "B"], ["2026-11-02T11:00:00", "C"], ["2026-11-02T12:00:00", "D"],
    ["2026-10-26T08:00:00", "A"], ["2026-10-26T09:00:00", "A"], ["2026-10-26T10:00:00", "A"], ["2026-10-26T11:00:00", "A"], ["2026-10-26T12:00:00", "A"], ["2026-10-26T13:00:00", "A"], ["2026-10-26T14:00:00", "A"], ["2026-10-26T15:00:00", "A"], ["2026-10-26T16:00:00", "A"], ["2026-10-26T17:00:00", "A"],
  ])
  const { weeks: result } = await weeks(sqliteAsD1(sqlite), NOW)
  assert.deepEqual([result[1]?.plays, result[1]?.change], [5, -50])
  assert.equal(result[1]?.topArtists.length, 3)
})

test("the weeks are the same whatever day of the week it is, from Monday to Sunday", async () => {
  const sqlite = database([["2026-11-09T00:00:00", "A"]])
  for (const day of ["2026-11-09T00:00:01Z", "2026-11-15T23:59:59Z"]) {
    assert.equal((await weeks(sqliteAsD1(sqlite), new Date(day))).weeks[0]?.start, "2026-11-09")
  }
  assert.equal((await weeks(sqliteAsD1(sqlite), new Date("2026-11-16T00:00:00Z"))).weeks[0]?.start, "2026-11-16")
})

test("an empty database is eight weeks of nothing", async () => {
  const { weeks: result } = await weeks(sqliteAsD1(database([])), NOW)
  assert.equal(result.length, WEEKS_SHOWN)
  assert.ok(result.every((week) => week.plays === 0 && week.change === null && week.topArtists.length === 0))
})
