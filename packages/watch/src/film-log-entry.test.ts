import { strict as assert } from "node:assert"
import { test } from "node:test"

import { filmLogKey, filmLogLine, readFilmLogEntry } from "./film-log-entry.ts"

const input = { watchedOn: "2026-11-05", title: "Aftersun", year: "2022", rating: "4,5", note: "Slow,\nand \"sad\"", cinema: "Vega kino" }

test("a valid entry is a line the log reads back", () => {
  const entry = readFilmLogEntry(input)
  assert.ok(entry)
  const line = filmLogLine(entry)
  assert.equal(line, '2026-11-05,Aftersun,2022,4.5,,"Slow, and ""sad""",,Vega kino')
  assert.equal(filmLogKey(line), "2026-11-05|aftersun")
})

test("optional fields may be empty", () => {
  const entry = readFilmLogEntry({ ...input, year: "", rating: "", note: "", cinema: "" })
  assert.ok(entry)
  assert.equal(filmLogLine(entry), "2026-11-05,Aftersun,,,,,,")
})

test("what the Rust importer refuses is refused here", () => {
  for (const bad of [{ watchedOn: "2026-13-01" }, { watchedOn: "05.11.2026" }, { title: "  " }, { year: "abc" }, { rating: "6" }, { rating: "3.3" }, { rating: "0" }, { year: "1500" }]) {
    assert.equal(readFilmLogEntry({ ...input, ...bad }), null, JSON.stringify(bad))
  }
})

test("comments and unreadable lines have no key", () => {
  assert.equal(filmLogKey("# note"), null)
  assert.equal(filmLogKey("2026-11-05"), null)
})
