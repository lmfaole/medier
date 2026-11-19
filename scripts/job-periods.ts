/** What the sync apps' timers say about their jobs, for the status report: read from `apps/<app>/sync-rust/schedule.json`. */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { APPS } from "./apps.ts"
import { jobKey, STALE_AFTER_HOURS, WEEKLY_STALE_AFTER_HOURS, type JobSchedule } from "./run-log.ts"
import { jobsFor, parseSchedule, type SyncSchedule } from "./sync-schedule.ts"

/** A calendar that starts with a weekday (`Mon *-*-* 04:47:00`) runs once a week. */
export const isWeekly = (calendar: string): boolean => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/.test(calendar)

/** Each job with the hours its most frequent timer allows between runs: a job in a daily and a weekly mode is a daily one. */
export function buildJobSchedule(schedules: readonly { app: string; schedule: SyncSchedule }[]): JobSchedule {
  const hours = new Map<string, number>()
  for (const { app, schedule } of schedules) {
    for (const timer of schedule.timers) {
      for (const job of jobsFor(schedule, timer.mode)) {
        const key = jobKey(app, job.join(" "))
        hours.set(key, Math.min(hours.get(key) ?? Infinity, isWeekly(timer.calendar) ? WEEKLY_STALE_AFTER_HOURS : STALE_AFTER_HOURS))
      }
    }
  }
  return { hours, apps: new Set(schedules.map((entry) => entry.app)) }
}

export function loadJobSchedule(root: string): JobSchedule {
  const schedules = APPS.map(({ name }) => ({ app: name, file: join(root, "apps", name, "sync-rust", "schedule.json") }))
    .filter(({ file }) => existsSync(file))
    .map(({ app, file }) => ({ app, schedule: parseSchedule(JSON.parse(readFileSync(file, "utf8"))) }))
  return buildJobSchedule(schedules)
}
