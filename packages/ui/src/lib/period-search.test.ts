import { strict as assert } from "node:assert"
import { test } from "node:test"

import * as v from "valibot"

import { legacyYearOf, MonthSearch, YearSearch } from "./period-search.ts"

const parse = <Schema extends v.GenericSchema>(schema: Schema, query: string) => v.parse(schema, Object.fromEntries(new URLSearchParams(query)))

test("the year a page asks for is kept only when it is a year", () => {
  assert.deepEqual(parse(YearSearch, "year=2025"), { year: "2025" })
  assert.equal(parse(YearSearch, "year=25").year, undefined)
  assert.equal(parse(YearSearch, "year=2025-03").year, undefined)
  assert.equal(parse(YearSearch, "").year, undefined)
})

test("the month of the apps that still go a month at a time is untouched", () => {
  assert.deepEqual(parse(MonthSearch, "month=2025-03"), { month: "2025-03" })
})

test("an old link with a month lands on the year that month is in, and a link with a year or nothing needs no landing", () => {
  assert.equal(legacyYearOf(new URLSearchParams("month=2025-03")), "2025")
  assert.equal(legacyYearOf(new URLSearchParams("month=2025-03&year=2024")), null)
  assert.equal(legacyYearOf(new URLSearchParams("month=2025-13")), null)
  assert.equal(legacyYearOf(new URLSearchParams("year=2025")), null)
  assert.equal(legacyYearOf(new URLSearchParams("")), null)
})
