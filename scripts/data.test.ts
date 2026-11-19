import { strict as assert } from "node:assert"
import { test } from "node:test"

import { DatabaseSync } from "node:sqlite"

import { assertReadOnlySql, databaseEnv, describeDatabase, formatRows, formatStatus, isDatabaseName, runQuery } from "./data.ts"
import type { LastRun } from "./run-log.ts"

test("only the databases that exist are accepted", () => {
  for (const name of ["music", "podcasts", "podcast_history", "github", "cv", "accounts", "photos", "site", "platform"]) assert.equal(isDatabaseName(name), true, name)
  assert.equal(isDatabaseName("data"), false, "the shared file is retired")
  assert.equal(isDatabaseName("salary"), false)
})

test("a database file is moved by its own variable", () => {
  assert.equal(databaseEnv("music"), "MUSIC_DB")
  assert.equal(databaseEnv("podcasts"), "PODCAST_DB")
})

test("status prints each source with its last run and marks a stale one", () => {
  const fresh: LastRun = { source: "music", job: "listens", startedAt: "2026-10-14T03:17:00.000Z", finishedAt: "2026-10-14T03:18:00.000Z", ok: true }
  const old: LastRun = { source: "music", job: "enrich", startedAt: "2026-10-12T00:00:00.000Z", finishedAt: "2026-10-12T00:01:00.000Z", ok: true }
  const lines = formatStatus([fresh, old], new Date("2026-10-14T06:00:00Z")).split("\n")
  assert.equal(lines.find((line) => line.includes("listens"))?.includes("STALE"), false)
  assert.equal(lines.find((line) => line.includes("enrich"))?.includes("STALE"), true)
})

test("a question may read but never write, attach or chain statements", () => {
  assert.equal(assertReadOnlySql("SELECT 1;"), "SELECT 1")
  assert.equal(assertReadOnlySql("pragma table_info(t)"), "pragma table_info(t)")
  for (const sql of ["DELETE FROM t", "SELECT 1; DROP TABLE t", "ATTACH 'x' AS y", "PRAGMA writable_schema = 1", "WITH a AS (SELECT 1) SELECT 1; SELECT 2", ""]) {
    assert.throws(() => assertReadOnlySql(sql), Error)
  }
})

test("rows are cut at the limit and a long cell is shortened", () => {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec("CREATE TABLE t (id INTEGER, note TEXT); INSERT INTO t VALUES (1, 'a'), (2, NULL), (3, '" + "x".repeat(100) + "')")
  assert.equal(runQuery(sqlite, "SELECT * FROM t ORDER BY id", 2), "id | note\n1 | a\n2 | NULL\n… more than 2 rows; add LIMIT or narrow the WHERE")
  assert.match(runQuery(sqlite, "SELECT note FROM t WHERE id = 3"), /^note\nx+…$/)
  assert.equal(formatRows([], 5), "(no rows)")
})

test("describe can be narrowed to one table, and a missing one is an error", () => {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec("CREATE TABLE a (id INTEGER PRIMARY KEY); CREATE TABLE b (name TEXT)")
  assert.equal(describeDatabase(sqlite, "x", "b").includes("## a"), false)
  assert.throws(() => describeDatabase(sqlite, "x", "c"), /no table "c"/)
})
