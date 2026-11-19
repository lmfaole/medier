import { strict as assert } from "node:assert"
import { test } from "node:test"

import { buildJobSchedule, isWeekly } from "./job-periods.ts"
import { jobKey, scheduledRuns, staleRuns, STALE_AFTER_HOURS, WEEKLY_STALE_AFTER_HOURS, type LastRun } from "./run-log.ts"
import { parseSchedule } from "./sync-schedule.ts"

const schedule = parseSchedule({
  requires: [],
  modes: { daily: ["listens", "summaries current"], all: ["summaries current", "totals all"] },
  timers: [
    { name: "frequent", description: "d", mode: "daily", calendar: "*-*-* 00/3:17:00", timeout: "1min" },
    { name: "weekly", description: "w", mode: "all", calendar: "Mon *-*-* 04:47:00", timeout: "1min" },
  ],
})
const jobs = buildJobSchedule([{ app: "music", schedule }])
const run = (source: string, job: string, startedAt: string): LastRun => ({ source, job, startedAt, finishedAt: startedAt, ok: true })

test("a job takes the period of its most frequent timer, and a weekday in the calendar means weekly", () => {
  assert.equal(isWeekly("Mon *-*-* 04:47:00"), true)
  assert.equal(isWeekly("*-*-* 04:47:00"), false)
  assert.equal(jobs.hours.get(jobKey("music", "listens")), STALE_AFTER_HOURS)
  assert.equal(jobs.hours.get(jobKey("music", "summaries current")), STALE_AFTER_HOURS)
  assert.equal(jobs.hours.get(jobKey("music", "totals all")), WEEKLY_STALE_AFTER_HOURS)
})

test("a weekly job is not late after five days, and a job no mode names is history, for the apps that have timers only", () => {
  const runs = [run("music", "totals all", "2026-10-26T04:00:00Z"), run("music", "quiz", "2026-10-15T04:00:00Z"), run("publish", "music", "2026-10-15T04:00:00Z")]
  const now = new Date("2026-10-31T06:00:00Z")
  assert.deepEqual(staleRuns(scheduledRuns(runs, jobs), now, STALE_AFTER_HOURS, 0, jobs).map((entry) => entry.job), ["music"])
  assert.equal(staleRuns(runs, now, STALE_AFTER_HOURS).length, 3, "without the schedule all three look late")
})
