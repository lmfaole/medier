/**
 * What `npm run data:refresh` runs, as pure functions: which apps to refresh and with which mode of their
 * `sync-rust/schedule.json`. The effects are `data-refresh.ts`'s; the jobs themselves are `sync-timers.ts`'s.
 */

import type { LastRun } from "./run-log.ts"
import { STALE_AFTER_HOURS, staleRuns } from "./run-log.ts"
import type { SyncSchedule } from "./sync-schedule.ts"

/** The mode of the schedule's first timer, which the schedule files list as the one that runs most often. */
export function quickestMode(schedule: SyncSchedule): string | undefined {
  return schedule.timers[0]?.mode
}

export interface AppJobs {
  app: string
  /** The jobs of the mode a refresh runs, as the run log names them. */
  jobs: string[]
}

/** Apps where a job of the refresh mode never ran, never finished or is older than the stale limit; other jobs' age is not this refresh's business. */
export function staleApps(apps: readonly AppJobs[], runs: readonly LastRun[], now: Date): string[] {
  return apps
    .filter(({ app, jobs }) => {
      const own = runs.filter((run) => run.source === app && jobs.includes(run.job))
      const stale = staleRuns(own, now, STALE_AFTER_HOURS).length > 0
      return stale || jobs.some((job) => !own.some((run) => run.job === job))
    })
    .map(({ app }) => app)
}

export const refreshCommand = (app: string, mode: string): string => `node scripts/sync-timers.ts ${app} run ${mode}`
