import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { DatabaseSync } from "node:sqlite"

import { addedRows, COUNTED, readFreshness } from "./freshness-plan.ts"
import { finishRun, startRun } from "./run-log.ts"

function runLog(): DatabaseSync {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec(readFileSync(join(import.meta.dirname, "..", "db", "platform.sql"), "utf8"))
  return sqlite
}

function run(sqlite: DatabaseSync, source: string, finished: string, error: string | null, added: number | null): void {
  const id = startRun(sqlite, source, "trakt", new Date(finished))
  finishRun(sqlite, id, new Date(finished), error)
  if (added !== null) sqlite.prepare("UPDATE sync_runs SET added = ? WHERE id = ?").run(added, id)
}

test("only growth counts as new rows", () => {
  assert.equal(addedRows(10, 14), 4)
  assert.equal(addedRows(10, 10), 0)
  assert.equal(addedRows(10, 7), 0)
})

test("the newest run that finished well and was counted is the one that is told", () => {
  const sqlite = runLog()
  run(sqlite, "film", "2026-10-20T03:00:00Z", null, 5)
  run(sqlite, "film", "2026-10-21T03:00:00Z", null, 2)
  run(sqlite, "film", "2026-10-22T03:00:00Z", "exit 1", 9)
  run(sqlite, "film", "2026-10-22T04:00:00Z", null, null)
  run(sqlite, "tv", "2026-10-22T05:00:00Z", null, 7)
  assert.deepEqual(readFreshness(sqlite, "film"), { finishedAt: "2026-10-21T03:00:00.000Z", added: 2, one: "visning", many: "visninger" })
})

test("an app with no sync, or none counted yet, has nothing to tell", () => {
  const sqlite = runLog()
  assert.equal(readFreshness(sqlite, "film"), null)
  assert.equal(readFreshness(sqlite, "forside"), null)
  assert.equal(COUNTED["forside"], undefined)
})
