/**
 * The run log: one `sync_runs` row per job a timer ran, so `npm run data:status`
 * can say which source has stopped. Written only by `scripts/sync-timers.ts`.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import * as v from "valibot"

/** A daily timer that has not finished in a day and a half has missed a run. */
export const STALE_AFTER_HOURS = 36
/** A weekly refresh (`--refresh`) or a job named `weekly-…` is only late after a week and a day. */
export const WEEKLY_STALE_AFTER_HOURS = 192
/** A job named `monthly-…` is only late after a month and a few days. */
export const MONTHLY_STALE_AFTER_HOURS = 24 * 35
/** For a status report: a run that has not finished may still be running; the longest timer allows two hours, so after this it was killed. */
export const UNFINISHED_AFTER_HOURS = 6
/** What runs when something arrives has no schedule to be late for; it counts only when it failed or never finished. */
const EVENT_DRIVEN_SOURCES: readonly string[] = ["inbox"]

const INSERT_RUN = "INSERT INTO sync_runs (source, job, started_at) VALUES (?, ?, ?)"
const RECORD_ADDED = "UPDATE sync_runs SET added = ? WHERE id = ?"
const FINISH_RUN = "UPDATE sync_runs SET finished_at = ?, ok = ?, error = ? WHERE id = ?"
// The newest run per source and job; `id` breaks a tie between equal timestamps.
const LAST_RUNS = `
  SELECT source, job, started_at, finished_at, ok FROM sync_runs AS run
  WHERE id = (SELECT id FROM sync_runs WHERE source = run.source AND job = run.job ORDER BY started_at DESC, id DESC LIMIT 1)
  ORDER BY source, job`

const RunRow = v.object({
  source: v.string(),
  job: v.string(),
  started_at: v.string(),
  finished_at: v.nullable(v.string()),
  ok: v.number(),
})

export interface LastRun {
  source: string
  job: string
  startedAt: string
  finishedAt: string | null
  ok: boolean
}

/** The database with the shared schema applied: the first timer run can come before any tool has created the table. */
export function openRunLog(databaseFile: string, schemaFile: string): DatabaseSync {
  const sqlite = new DatabaseSync(databaseFile)
  // A tool writes the same file while this runs; wait for it instead of failing.
  sqlite.exec("PRAGMA busy_timeout = 5000")
  sqlite.exec(readFileSync(schemaFile, "utf8"))
  return sqlite
}

/** Runs `work` as one logged job of the platform log; what it returns is the failure (or `null`), a throw is logged and rethrown. */
export function loggedRun(source: string, job: string, work: () => string | null): string | null {
  const root = join(import.meta.dirname, "..")
  const log = openRunLog(process.env["PLATFORM_DB"] ?? join(root, ".data", "platform.db"), join(root, "db", "platform.sql"))
  const runId = startRun(log, source, job, new Date())
  try {
    const failure = work()
    finishRun(log, runId, new Date(), failure)
    return failure
  } catch (error) {
    finishRun(log, runId, new Date(), error instanceof Error ? error.message : String(error))
    throw error
  } finally {
    log.close()
  }
}

/** The row id; the run counts as unfinished until `finishRun`. */
export function startRun(sqlite: DatabaseSync, source: string, job: string, now: Date): number {
  const { lastInsertRowid } = sqlite.prepare(INSERT_RUN).run(source, job, now.toISOString())
  return Number(lastInsertRowid)
}

export function finishRun(sqlite: DatabaseSync, id: number, now: Date, error: string | null): void {
  sqlite.prepare(FINISH_RUN).run(now.toISOString(), error === null ? 1 : 0, error, id)
}

/** The rows a whole timer run added, kept on its last job. */
export function recordAdded(sqlite: DatabaseSync, id: number, added: number): void {
  sqlite.prepare(RECORD_ADDED).run(added, id)
}

export function lastRuns(sqlite: DatabaseSync): LastRun[] {
  return v.parse(v.array(RunRow), sqlite.prepare(LAST_RUNS).all()).map((row) => ({
    source: row.source,
    job: row.job,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    ok: row.ok === 1,
  }))
}

/** What the timers say about the jobs of the sync apps: how long each may go between runs, and which apps have timers at all. */
export interface JobSchedule {
  /** By `jobKey`: the hours the job's most frequent timer allows. */
  hours: ReadonlyMap<string, number>
  apps: ReadonlySet<string>
}

export const jobKey = (source: string, job: string): string => `${source}|${job}`

/** The runs of a sync app's jobs that no timer's mode names any more are history, not a job that has stopped. */
export function scheduledRuns(runs: readonly LastRun[], schedule: JobSchedule): LastRun[] {
  return runs.filter((run) => !schedule.apps.has(run.source) || schedule.hours.has(jobKey(run.source, run.job)))
}

/** How late a job may be before it is stale: what its timers say, else its name's, else `afterHours` for a daily one. */
function allowedHours(run: LastRun, afterHours: number, schedule: JobSchedule | undefined): number {
  const own = schedule?.hours.get(jobKey(run.source, run.job))
  if (own !== undefined) return Math.max(afterHours, own)
  if (run.job.startsWith("monthly-")) return Math.max(afterHours, MONTHLY_STALE_AFTER_HOURS)
  if (run.job.includes("--refresh") || run.job.startsWith("weekly-")) return Math.max(afterHours, WEEKLY_STALE_AFTER_HOURS)
  return afterHours
}

/** Runs that never finished, or whose last start is older than `afterHours` (a weekly job: a week and a day). */
export function staleRuns(runs: readonly LastRun[], now: Date, afterHours: number, unfinishedGraceHours = 0, schedule?: JobSchedule): LastRun[] {
  return runs.filter((run) => {
    if (run.finishedAt === null) return Date.parse(run.startedAt) < now.getTime() - unfinishedGraceHours * 3_600_000
    return !EVENT_DRIVEN_SOURCES.includes(run.source) && Date.parse(run.startedAt) < now.getTime() - allowedHours(run, afterHours, schedule) * 3_600_000
  })
}
