/**
 * `npm run ship [-- <app>… | --with-shared | --dry-run | --jobs N | --force]`: AGENTS.md rule 7, a commit that changes an app is
 * followed by that app's `npm run deploy`. With no app named, the apps whose own files the last commit
 * changed are deployed; a change to shared code only says so, because it would deploy every app, which
 * `--with-shared` asks for. A deploy is public, so `--dry-run` names the apps and stops.
 *
 * Up to `--jobs` (3) apps are deployed at once, the slowest first, so one app's build overlaps the others' uploads;
 * `forside` goes last and only when every other app succeeded (`ship-plan.ts`). An app whose built output is the one
 * last deployed uploads nothing (`deploy-hash.ts`; `--force` deploys it anyway). Each app's output is streamed to
 * `.data/tmp/ship/<app>.log`; the terminal gets one line per app as it ends and a summary table. Exit code 1 when any app failed.
 */

import { type ChildProcess, spawn, spawnSync } from "node:child_process"
import { createWriteStream, mkdirSync } from "node:fs"
import { join } from "node:path"

import { shipTargets } from "./affected-plan.ts"
import { APPS, namedApps, SERVED_APPS } from "./apps.ts"
import { UNCHANGED_MARK } from "./deploy-run.ts"
import { formatSummary, jobsFrom, mediaRefusal, type Run, runShip, splitTargets } from "./ship-plan.ts"
import { tail } from "./verify-plan.ts"

const root = join(import.meta.dirname, "..")
const args = process.argv.slice(2)
// `--jobs 5`: the 5 is not an app.
const appArgs = args.filter((arg, index) => args[index - 1] !== "--jobs" && arg !== "--jobs")
const named = namedApps(appArgs)
const namedMedia = named.filter((app) => SERVED_APPS.includes(app))
if (namedMedia.length > 0) {
  throw new Error(`ship: ${mediaRefusal(namedMedia)}`)
}
const dryRun = args.includes("--dry-run")
const force = args.includes("--force")
const jobs = jobsFrom(args)

const changed = spawnSync("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.split("\n")
const plan = shipTargets(changed, args.includes("--with-shared"))
const targets = named.length > 0 ? named : plan.deploy

if (plan.sharedChanged.length > 0) console.log(`shared code changed (${plan.sharedChanged.join(", ")}): ship --with-shared deploys every app`)
if (plan.media.length > 0) console.log(`not shipped: ${mediaRefusal(plan.media)}`)
if (targets.length === 0) console.log("no app to deploy: the last commit changed no app's own files")

const { pool, last } = splitTargets(targets, APPS.map((app) => app.name))
const logs = join(root, ".data", "tmp", "ship")
const children = new Set<ChildProcess>()

function deploy(app: string): Promise<Run> {
  return new Promise((resolve) => {
    const started = Date.now()
    const logFile = join(logs, `${app}.log`)
    const log = createWriteStream(logFile)
    let output = ""
    const child = spawn("npm", ["run", "deploy", ...(force ? ["--", "--force"] : [])], { cwd: join(root, "apps", app), stdio: ["ignore", "pipe", "pipe"] })
    children.add(child)
    const take = (chunk: Buffer) => {
      log.write(chunk)
      output += chunk.toString()
    }
    child.stdout.on("data", take)
    child.stderr.on("data", take)
    const end = (status: number | null, error?: Error) => {
      children.delete(child)
      log.end()
      const seconds = (Date.now() - started) / 1000
      if (status === 0) resolve({ ok: true, unchanged: output.includes(UNCHANGED_MARK), seconds })
      else resolve({ ok: false, unchanged: false, seconds, detail: error?.message ?? `exit ${status}, whole log: ${logFile}\n${tail(output, 30)}` })
    }
    child.once("error", (error) => end(null, error))
    child.once("close", (status) => end(status))
  })
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    for (const child of children) child.kill("SIGTERM")
    console.error(`ship: ${signal}, stopped ${children.size} running deploy(s); an app stopped half way is not deployed`)
    process.exitCode = 130
  })
}

if (dryRun) {
  console.log(`would deploy: ${targets.join(", ") || "nothing"}${targets.length > 1 ? ` (${jobs} at a time${last.length > 0 ? `, ${last.join(", ")} last, only if the others succeed` : ""})` : ""}`)
} else if (targets.length > 0) {
  mkdirSync(logs, { recursive: true })
  const wallStarted = Date.now()
  const results = await runShip({
    pool,
    last,
    jobs,
    run: deploy,
    started: (app) => console.log(`deploying ${app}…`),
    finished: (result) => {
      if (result.outcome === "failed") console.log(`FAILED ${result.app} after ${result.seconds.toFixed(0)}s (${result.detail})`)
      else if (result.outcome === "held back") console.log(`HELD BACK ${result.app}: ${result.detail}`)
      else console.log(`${result.outcome} ${result.app} in ${result.seconds.toFixed(0)}s`)
    },
  })
  console.log(`\n${formatSummary(results, (Date.now() - wallStarted) / 1000)}`)
  if (results.some((result) => result.outcome === "failed" || result.outcome === "held back")) process.exitCode = 1
}
