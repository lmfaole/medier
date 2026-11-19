import { strict as assert } from "node:assert"
import { test } from "node:test"

import * as v from "valibot"

import { entityRequest, historyRequest, libraryRequest, overviewRequest, yearHistoryRequest } from "./page-requests.ts"
import { MonthSearch, YearSearch } from "./period-search.ts"

const parse = <Schema extends v.GenericSchema>(schema: Schema, query: string) => v.parse(schema, Object.fromEntries(new URLSearchParams(query)))

test("the overview and the library ask for their one file", () => {
  assert.deepEqual(overviewRequest(), { file: "overview", params: {} })
  assert.deepEqual(libraryRequest(), { file: "library", params: {} })
})

test("the history asks for the newest month without one", () => {
  assert.deepEqual(historyRequest(parse(MonthSearch, "")).params, {})
  assert.deepEqual(historyRequest(parse(MonthSearch, "month=2024-02")).params, { month: "2024-02" })
})

test("an entity is asked for by slug, and by kind where the app has several", () => {
  assert.deepEqual(entityRequest("heat-1995"), { file: "entity", params: { slug: "heat-1995" } })
  assert.deepEqual(entityRequest("al-pacino", "person").params, { kind: "person", slug: "al-pacino" })
})

test("the history of the apps that go a year at a time asks for the newest year without one", () => {
  assert.deepEqual(yearHistoryRequest(parse(YearSearch, "")), { file: "history", params: {} })
  assert.deepEqual(yearHistoryRequest(parse(YearSearch, "year=2025")), { file: "history", params: { year: "2025" } })
})
