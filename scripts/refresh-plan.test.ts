import { strict as assert } from "node:assert"
import { test } from "node:test"

import { quickestMode, staleApps } from "./refresh-plan.ts"
import type { LastRun } from "./run-log.ts"
import { parseSchedule } from "./sync-schedule.ts"

const now = new Date("2026-10-21T12:00:00Z")
const run = (source: string, startedAt: string, finishedAt: string | null = startedAt): LastRun => ({ source, job: "enrich", startedAt, finishedAt, ok: true })

test("the first timer's mode is the one to refresh with", () => {
  const schedule = parseSchedule({
    requires: [],
    modes: { daily: ["a"], weekly: ["b"] },
    timers: [
      { name: "daily", description: "d", mode: "daily", calendar: "daily", timeout: "1min" },
      { name: "weekly", description: "w", mode: "weekly", calendar: "weekly", timeout: "1min" },
    ],
  })
  assert.equal(quickestMode(schedule), "daily")
})

test("an app is stale when a job of its mode is old, unfinished or has never run; other jobs do not count", () => {
  const runs = [
    run("music", "2026-10-21T08:00:00Z"),
    { ...run("music", "2026-10-10T08:00:00Z"), job: "listens" },
    run("film", "2026-10-18T08:00:00Z"),
    run("tv", "2026-10-21T08:00:00Z", null),
  ]
  const apps = [
    { app: "music", jobs: ["enrich"] },
    { app: "film", jobs: ["enrich"] },
    { app: "tv", jobs: ["enrich"] },
    { app: "podkast", jobs: ["enrich"] },
    { app: "work", jobs: ["enrich", "other"] },
  ]
  assert.deepEqual(staleApps(apps, runs, now), ["film", "tv", "podkast", "work"])
})
