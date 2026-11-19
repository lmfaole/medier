/**
 * `npm run log:remove -- <day|-> <title>`: removes the one line of `.data/film-log.csv` for that day (`-` for a line with no day) and
 * title, then imports the log and dumps the data. The log is copied to `film-log.csv.bak-<time>` first, and a missing or an
 * ambiguous line is refused. Trakt keeps its own plays: a line removed here is never removed there.
 */

import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { removeLine } from "./log-settle-plan.ts"
import { parseEnv, withCargoOnPath } from "./sync-schedule.ts"

const ROOT = join(import.meta.dirname, "..")
const LOG = join(ROOT, ".data", "film-log.csv")
const [day, title] = process.argv.slice(2)
if (day === undefined || title === undefined) throw new Error("usage: npm run log:remove -- <day|-> <title>")

const result = removeLine(readFileSync(LOG, "utf8"), day === "-" ? "" : day, title)
if ("refused" in result.outcome) throw new Error(`nothing was written: ${result.outcome.refused}`)
console.log(`removed: ${result.outcome.removed}`)

const backup = `${LOG}.bak-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`
copyFileSync(LOG, backup)
writeFileSync(LOG, result.text)
console.log(`the old log is kept as ${backup}`)

const settings = join(homedir(), ".config", "film-sync.env")
const env = { ...process.env, ...(existsSync(settings) ? parseEnv(readFileSync(settings, "utf8")) : {}), PATH: withCargoOnPath(process.env["PATH"], homedir()) }
const imported = spawnSync("cargo", ["run", "-q", "-p", "film-sync", "--", "import-log"], { cwd: join(ROOT, "apps", "film"), stdio: "inherit", env })
if (imported.status !== 0) throw new Error("import-log failed")
spawnSync("npm", ["run", "-s", "data:dump"], { cwd: ROOT, stdio: "inherit" })
