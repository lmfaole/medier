/**
 * How `npm run ship` schedules several apps: a few at a time instead of strictly one after another, the slowest
 * first so the long deploy (music) does not start last, and the apps in `LAST` only when everything before them
 * succeeded. Pure and async only through the `run` it is given, so the ordering, the limit and the failure rules
 * can be tested without a deploy. A deploy of one app never waits for another's, except through that app's own lock
 * (`deploy-lock.ts`), so two ships of the same app still queue.
 */

/** Deployed after all the others, alone: forside's redirects for moved addresses (`/musikk` → `/apps/musikk`) must not go live before the apps they point at. */
export const LAST: readonly string[] = ["forside"]

/** Apps deployed at once: a build takes ~1 GB and most of a few cores, the Wrangler upload waits for Cloudflare, so builds overlap other apps' uploads. */
export const DEFAULT_JOBS = 3

/** What `ship` says to an app of the media server (a media app or a home app): it has no deploy. */
export function mediaRefusal(apps: readonly string[]): string {
  return `${apps.join(", ")} ${apps.length === 1 ? "is" : "are"} served by the media server: ${apps.length === 1 ? "it" : "they"} no longer deploy to Cloudflare. Run \`npm run media:build\`, then restart the media server (scripts/media-server.ts).`
}

export type Outcome = "deployed" | "unchanged" | "failed" | "held back"

export interface AppResult {
  app: string
  outcome: Outcome
  seconds: number
  /** Why it failed or was held back. */
  detail?: string
}

export interface Run {
  ok: boolean
  /** `wrangler deploy` was skipped because the built output was the one last deployed. */
  unchanged: boolean
  seconds: number
  detail?: string
}

/** The targets split into the pool's and the last ones; the pool's in `order` (slowest first, the order of `APPS`), apps not in it after. */
export function splitTargets(targets: readonly string[], order: readonly string[]): { pool: string[]; last: string[] } {
  const rank = (app: string) => (order.includes(app) ? order.indexOf(app) : order.length)
  const unique = [...new Set(targets)]
  return {
    pool: unique.filter((app) => !LAST.includes(app)).toSorted((a, b) => rank(a) - rank(b)),
    last: unique.filter((app) => LAST.includes(app)),
  }
}

/** `--jobs N` (or `--jobs=N`), at least 1; the default when absent or not a number. */
export function jobsFrom(args: readonly string[], fallback = DEFAULT_JOBS): number {
  const index = args.findIndex((arg) => arg === "--jobs" || arg.startsWith("--jobs="))
  if (index === -1) return fallback
  const arg = args[index] ?? ""
  const value = Number(arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : args[index + 1])
  return Number.isInteger(value) && value >= 1 ? value : fallback
}

function toResult(app: string, run: Run): AppResult {
  const outcome: Outcome = !run.ok ? "failed" : run.unchanged ? "unchanged" : "deployed"
  return { app, outcome, seconds: run.seconds, ...(run.detail === undefined ? {} : { detail: run.detail }) }
}

/**
 * Runs the pool with at most `jobs` at once, then the last apps one at a time, and only if no app failed.
 * A failure never stops the apps already started or still waiting (they are independent); the results come back in
 * the order the apps were given, `pool` then `last`.
 */
export async function runShip({
  pool,
  last,
  jobs,
  run,
  started = () => {},
  finished = () => {},
}: {
  pool: readonly string[]
  last: readonly string[]
  jobs: number
  run: (app: string) => Promise<Run>
  started?: (app: string) => void
  finished?: (result: AppResult) => void
}): Promise<AppResult[]> {
  const results = new Map<string, AppResult>()
  const attempt = async (app: string): Promise<void> => {
    started(app)
    let result: AppResult
    try {
      result = toResult(app, await run(app))
    } catch (error) {
      result = { app, outcome: "failed", seconds: 0, detail: error instanceof Error ? error.message : String(error) }
    }
    results.set(app, result)
    finished(result)
  }

  const queue = [...pool]
  const worker = async (): Promise<void> => {
    for (let app = queue.shift(); app !== undefined; app = queue.shift()) await attempt(app)
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, queue.length)) }, worker))

  const failedBefore = [...results.values()].filter((result) => result.outcome === "failed").map((result) => result.app)
  for (const app of last) {
    if (failedBefore.length > 0) {
      const held: AppResult = { app, outcome: "held back", seconds: 0, detail: `${failedBefore.join(", ")} failed, and ${app} redirects to the apps` }
      results.set(app, held)
      finished(held)
    } else await attempt(app)
  }
  return [...pool, ...last].flatMap((app) => results.get(app) ?? [])
}

const minutes = (seconds: number): string => (seconds >= 60 ? `${Math.floor(seconds / 60)}m${String(Math.round(seconds % 60)).padStart(2, "0")}s` : `${Math.round(seconds)}s`)

/** The compact table: one line per app, then the wall clock against the sum of the apps. */
export function formatSummary(results: readonly AppResult[], wallSeconds: number): string {
  const width = Math.max(0, ...results.map((result) => result.app.length))
  const lines = results.map((result) => `${result.app.padEnd(width)}  ${result.outcome.padEnd(9)}  ${minutes(result.seconds).padStart(6)}${result.detail && result.outcome === "held back" ? `  (${result.detail})` : ""}`)
  const sum = results.reduce((total, result) => total + result.seconds, 0)
  const failed = results.filter((result) => result.outcome === "failed" || result.outcome === "held back").length
  lines.push(`total ${minutes(wallSeconds)} (the apps one after another: ${minutes(sum)})${failed > 0 ? `, ${failed} not deployed` : ""}`)
  return lines.join("\n")
}
