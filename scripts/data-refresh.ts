/**
 * `npm run data:refresh [-- --stale | --dry-run | <app>…]`: the data tools' quickest mode now (each app's first timer in
 * `sync-rust/schedule.json`), for "fresh data" between the timers. The apps do not share a database, so they
 * run at the same time; one line each, and the end of the log for one that failed. This reaches the services
 * the tools read (Last.fm, TMDB, Trakt, …), so name apps or `--stale` rather than refreshing all by habit.
 * What changed reaches a Worker with `npm run ship` (a deploy takes a fresh snapshot).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { APPS, namedApps } from "./apps.ts"
import { lastRuns } from "./run-log.ts"
import { quickestMode, refreshCommand, staleApps } from "./refresh-plan.ts"
import { runParallel } from "./run-parallel.ts"
import { jobsFor, parseSchedule } from "./sync-schedule.ts"
import { tail } from "./verify-plan.ts"

const root = join(import.meta.dirname, "..")
const args = process.argv.slice(2)
const named = namedApps(args)

const scheduled = APPS.map((app) => app.name).filter((name) => existsSync(join(root, "apps", name, "sync-rust", "schedule.json")))
const wanted = named.length > 0 ? named : scheduled

const planned = wanted.flatMap((app) => {
  const schedule = parseSchedule(JSON.parse(readFileSync(join(root, "apps", app, "sync-rust", "schedule.json"), "utf8")))
  const mode = quickestMode(schedule)
  return mode === undefined ? [] : [{ app, mode, jobs: jobsFor(schedule, mode).map((job) => job.join(" ")) }]
})

let jobs = planned.map((entry) => ({ ...entry, command: refreshCommand(entry.app, entry.mode) }))
if (args.includes("--stale")) {
  const log = new DatabaseSync(join(root, ".data", "platform.db"), { readOnly: true })
  const stale = new Set(staleApps(planned, lastRuns(log), new Date()))
  log.close()
  jobs = jobs.filter((job) => stale.has(job.app))
}

if (jobs.length === 0) {
  console.log("nothing to refresh")
} else if (args.includes("--dry-run")) {
  for (const job of jobs) console.log(`would run ${job.command}`)
} else {
  const logs = join(root, ".data", "tmp", "refresh")
  mkdirSync(logs, { recursive: true })
  const started = Date.now()
  const results = await runParallel(jobs.map((job) => job.command))
  for (const [index, result] of results.entries()) {
    const job = jobs[index]
    if (job === undefined) continue
    const log = join(logs, `${job.app}.log`)
    writeFileSync(log, result.output)
    console.log(result.code === 0 ? `ok     ${job.app} (${job.mode})` : `FAILED ${job.app} (${job.mode}, whole log: ${log})\n${tail(result.output, 20)}\n`)
  }
  console.log(`${((Date.now() - started) / 1000).toFixed(0)}s; to publish what changed: npm run ship -- ${jobs.map((job) => job.app).join(" ")}`)
  process.exitCode = results.some((result) => result.code !== 0) ? 1 : 0
}
