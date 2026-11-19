import { strict as assert } from "node:assert"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { DatabaseSync } from "node:sqlite"

import { finishRun, lastRuns, openRunLog, STALE_AFTER_HOURS, staleRuns, startRun, UNFINISHED_AFTER_HOURS } from "./run-log.ts"

function database(): DatabaseSync {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec(readFileSync(join(import.meta.dirname, "..", "db", "platform.sql"), "utf8"))
  return sqlite
}

const at = (iso: string): Date => new Date(iso)

test("a finished run is ok and has an end time", () => {
  const sqlite = database()
  const id = startRun(sqlite, "music", "listens", at("2026-10-14T03:17:00Z"))
  finishRun(sqlite, id, at("2026-10-14T03:18:00Z"), null)
  assert.deepEqual(lastRuns(sqlite), [
    { source: "music", job: "listens", startedAt: "2026-10-14T03:17:00.000Z", finishedAt: "2026-10-14T03:18:00.000Z", ok: true },
  ])
})

test("a failed run is not ok and keeps its end time", () => {
  const sqlite = database()
  const id = startRun(sqlite, "music", "enrich", at("2026-10-14T03:17:00Z"))
  finishRun(sqlite, id, at("2026-10-14T03:19:00Z"), "exit 1")
  const [run] = lastRuns(sqlite)
  assert.equal(run?.ok, false)
  assert.equal(run?.finishedAt, "2026-10-14T03:19:00.000Z")
})

test("lastRuns returns only the newest run per source and job", () => {
  const sqlite = database()
  finishRun(sqlite, startRun(sqlite, "music", "listens", at("2026-10-13T03:17:00Z")), at("2026-10-13T03:18:00Z"), "exit 1")
  finishRun(sqlite, startRun(sqlite, "music", "listens", at("2026-10-14T03:17:00Z")), at("2026-10-14T03:18:00Z"), null)
  finishRun(sqlite, startRun(sqlite, "music", "enrich", at("2026-10-14T03:18:00Z")), at("2026-10-14T03:19:00Z"), null)
  const runs = lastRuns(sqlite)
  assert.equal(runs.length, 2)
  assert.equal(runs.find((run) => run.job === "listens")?.ok, true)
})

test("staleRuns flags a run older than 36 hours and a run that never finished", () => {
  assert.equal(STALE_AFTER_HOURS, 36)
  const sqlite = database()
  finishRun(sqlite, startRun(sqlite, "music", "old", at("2026-10-12T00:00:00Z")), at("2026-10-12T00:01:00Z"), null)
  finishRun(sqlite, startRun(sqlite, "music", "fresh", at("2026-10-14T03:00:00Z")), at("2026-10-14T03:01:00Z"), null)
  startRun(sqlite, "music", "stuck", at("2026-10-14T03:00:00Z"))
  const stale = staleRuns(lastRuns(sqlite), at("2026-10-14T06:00:00Z"), STALE_AFTER_HOURS).map((run) => run.job)
  assert.deepEqual(stale.toSorted(), ["old", "stuck"])
  const report = (now: string) => staleRuns(lastRuns(sqlite), at(now), STALE_AFTER_HOURS, UNFINISHED_AFTER_HOURS).map((run) => run.job)
  assert.deepEqual(report("2026-10-14T05:00:00Z"), ["old"], "a run started two hours ago may still be running")
  assert.deepEqual(report("2026-10-14T10:00:00Z").toSorted(), ["old", "stuck"])
})

test("a weekly refresh is only stale after a week and a day", () => {
  const sqlite = database()
  finishRun(sqlite, startRun(sqlite, "film", "tmdb --refresh", at("2026-10-07T04:25:00Z")), at("2026-10-07T04:26:00Z"), null)
  assert.deepEqual(staleRuns(lastRuns(sqlite), at("2026-10-14T06:00:00Z"), STALE_AFTER_HOURS), [])
  assert.equal(staleRuns(lastRuns(sqlite), at("2026-10-16T06:00:00Z"), STALE_AFTER_HOURS).length, 1)
})

test("a weekly-… job waits a week, a monthly-… job a month, and an inbox run is never late, only failed or unfinished", () => {
  const sqlite = database()
  const done = (source: string, job: string, started: string) => finishRun(sqlite, startRun(sqlite, source, job, at(started)), at(started), null)
  done("repo", "weekly-audit", "2026-10-07T04:00:00Z")
  done("data", "monthly-rehearse", "2026-09-20T04:00:00Z")
  done("inbox", "spotify", "2026-08-01T04:00:00Z")
  startRun(sqlite, "inbox", "lastfm", at("2026-08-01T04:00:00Z"))
  const now = at("2026-10-14T06:00:00Z")
  assert.deepEqual(staleRuns(lastRuns(sqlite), now, STALE_AFTER_HOURS).map((run) => run.job), ["lastfm"])
  assert.deepEqual(staleRuns(lastRuns(sqlite), at("2026-11-01T06:00:00Z"), STALE_AFTER_HOURS).map((run) => run.job).toSorted(), ["lastfm", "monthly-rehearse", "weekly-audit"])
})

test("openRunLog creates the table in a database that has none, and keeps old rows when reopened", () => {
  const file = join(mkdtempSync(join(tmpdir(), "run-log-")), "data.db")
  const schema = join(import.meta.dirname, "..", "db", "platform.sql")
  const first = openRunLog(file, schema)
  startRun(first, "music", "listens", at("2026-10-14T03:17:00Z"))
  first.close()
  const second = openRunLog(file, schema)
  assert.equal(lastRuns(second).length, 1)
  second.close()
})
