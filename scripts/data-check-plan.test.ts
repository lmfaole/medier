import { strict as assert } from "node:assert"
import { test } from "node:test"
import { DatabaseSync } from "node:sqlite"

import { integrityProblems, schemaDrift } from "./data-check-plan.ts"

test("a row that points at nothing is reported, and a sound database is not", () => {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec("CREATE TABLE parent (id INTEGER PRIMARY KEY); CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id))")
  sqlite.exec("INSERT INTO parent VALUES (1); INSERT INTO child VALUES (1, 1)")
  assert.deepEqual(integrityProblems(sqlite), [])
  sqlite.exec("PRAGMA foreign_keys = OFF; INSERT INTO child VALUES (2, 99)")
  assert.deepEqual(integrityProblems(sqlite), ["1 row(s) point at a row that is not there (first in table child)"])
})

test("what the schema makes and the file lacks is listed, and so is what the file has that the schema does not name", () => {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec("CREATE TABLE a (x INTEGER, extra TEXT)")
  const schema = "CREATE TABLE IF NOT EXISTS a (x INTEGER, y TEXT); CREATE TABLE IF NOT EXISTS b (z INTEGER)"
  assert.deepEqual(schemaDrift(sqlite, schema), ["a.y is missing", "table b is missing", "a.extra is not in the schema"])
})
