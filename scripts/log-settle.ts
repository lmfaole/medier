/**
 * `npm run log:settle`: writes the year and TMDB's number on the log lines of the viewings TMDB could not match by title,
 * then imports the log, fetches the films and dumps the data. It runs as you, so it can write `.data/film-log.csv`.
 * The log is copied to `film-log.csv.bak-<time>` first, and nothing is written if a line is refused.
 */

import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { settleLog, type Settle } from "./log-settle-plan.ts"
import { parseEnv, withCargoOnPath } from "./sync-schedule.ts"

const ROOT = join(import.meta.dirname, "..")
const LOG = join(ROOT, ".data", "film-log.csv")

const FIXES: Settle[] = [
  { day: "2025-07-08", title: "F1 ® The Movie", year: 2025, tmdbId: 911430 },
  { day: "2025-07-26", title: "Fantastic 4: First Steps", year: 2025, tmdbId: 617126 },
]

function run(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): number {
  return spawnSync(command, args, { cwd, stdio: "inherit", env: env ?? process.env }).status ?? 1
}

const settled = settleLog(readFileSync(LOG, "utf8"), FIXES)
for (const line of settled.changed) console.log(`settled: ${line}`)
for (const line of settled.already) console.log(`already settled: ${line}`)
for (const line of settled.refused) console.log(`REFUSED: ${line}`)
if (settled.refused.length > 0) throw new Error("nothing was written: fix the refused lines first")

if (settled.changed.length > 0) {
  const backup = `${LOG}.bak-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`
  copyFileSync(LOG, backup)
  writeFileSync(LOG, settled.text)
  console.log(`the old log is kept as ${backup}`)
}

const film = join(ROOT, "apps", "film")
const settings = join(homedir(), ".config", "film-sync.env")
const env = { ...process.env, ...(existsSync(settings) ? parseEnv(readFileSync(settings, "utf8")) : {}), PATH: withCargoOnPath(process.env["PATH"], homedir()) }
if (run("cargo", ["run", "-q", "-p", "film-sync", "--", "import-log"], film, env) !== 0) throw new Error("import-log failed")
if (run("cargo", ["run", "-q", "-p", "film-sync", "--", "tmdb"], film, env) !== 0) throw new Error("tmdb failed")

const ids = FIXES.map((fix) => fix.tmdbId).join(",")
run("npm", ["run", "-s", "data:query", "--", "film", `SELECT tmdb_id, title, release_date FROM film_title WHERE tmdb_id IN (${ids})`], ROOT)
console.log("Check that each film above is the right one (F1 2025, The Fantastic 4: First Steps 2025). Dumping the data:")
run("npm", ["run", "-s", "data:dump"], ROOT)
