/**
 * `npm run land -- <source> <file-or-folder> [--date YYYY-MM-DD] [--dry-run] [--import]`: an export, kept as
 * it came. The rule: copy (never move) to
 * `.data/raw/<source>/<date>/`, check each copy against the original, write the manifest `<date>.sha256`
 * beside the folder and lock the folder read-only. Running it again lands nothing twice; a different file at
 * a landed place is refused and nothing is written. The date is the day the file was made (its mtime) unless
 * given. The importer is printed, and run only with `--import`.
 */

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"

import { DATE, SOURCE, importerFor, manifestText, planLanding, type Hashed, type LandingPlan } from "./land-plan.ts"

function hashFile(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex")
}

/** Every file under `directory` with its hash, paths relative to it. */
export function hashTree(directory: string): Hashed[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .map((file) => ({ path: relative(directory, file).split("\\").join("/"), sha256: hashFile(file) }))
}

function lock(directory: string, writable: boolean): void {
  const entries = readdirSync(directory, { recursive: true, withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) chmodSync(join(entry.parentPath, entry.name), writable ? 0o755 : 0o555)
    else chmodSync(join(entry.parentPath, entry.name), 0o444)
  }
  chmodSync(directory, writable ? 0o755 : 0o555)
}

export interface Landed {
  plan: LandingPlan
  folder: string
}

/** Lands `from` (a file, or a folder whose contents keep their paths) under `<raw>/<source>/<date>`. */
export function land(from: string, raw: string, source: string, date: string, dryRun: boolean): Landed {
  const folder = join(raw, source, date)
  const stat = statSync(from)
  const base = stat.isDirectory() ? from : dirname(from)
  const incoming = stat.isDirectory() ? hashTree(from) : [{ path: from.slice(base.length + 1), sha256: hashFile(from) }]
  const plan = planLanding(incoming, hashTree(folder))
  if (plan.conflicts.length > 0 || dryRun || plan.copy.length === 0) return { plan, folder }

  mkdirSync(folder, { recursive: true })
  lock(folder, true)
  for (const path of plan.copy) {
    const target = join(folder, path)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(join(base, path), target)
  }
  const landed = hashTree(folder)
  for (const path of plan.copy) {
    const original = incoming.find((file) => file.path === path)?.sha256
    if (landed.find((file) => file.path === path)?.sha256 !== original) throw new Error(`the copy of ${path} differs from the original; ${folder} was left unlocked`)
  }
  writeFileSync(join(raw, source, `${date}.sha256`), manifestText(date, landed))
  lock(folder, false)
  return { plan, folder }
}

if (import.meta.filename === process.argv[1]) {
  const args = process.argv.slice(2)
  const option = (name: string): string | undefined => args[args.indexOf(name) + 1]
  const [source = "", from = ""] = args.filter((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--date")
  if (!SOURCE.test(source) || from === "" || !existsSync(from)) throw new Error("usage: npm run land -- <source> <file-or-folder> [--date YYYY-MM-DD] [--dry-run] [--import]")
  const date = args.includes("--date") ? (option("--date") ?? "") : statSync(from).mtime.toISOString().slice(0, 10)
  if (!DATE.test(date)) throw new Error(`the date ${date} is not YYYY-MM-DD`)

  const raw = join(import.meta.dirname, "..", ".data", "raw")
  const { plan, folder } = land(from, raw, source, date, args.includes("--dry-run"))
  if (plan.conflicts.length > 0) {
    console.log(`REFUSED: ${plan.conflicts.length} file(s) in ${folder} differ from what is being landed (a landed original is never rewritten):\n  ${plan.conflicts.join("\n  ")}`)
    process.exitCode = 1
  } else {
    const verb = args.includes("--dry-run") ? "would copy" : "copied"
    console.log(`${verb} ${plan.copy.length}, already landed ${plan.already.length}: ${folder}`)
    const importer = importerFor(source, folder)
    if (importer === undefined) console.log(`no importer for "${source}" yet`)
    else if (args.includes("--import") && !args.includes("--dry-run")) process.exitCode = spawnSync(importer, { shell: true, stdio: "inherit", cwd: join(import.meta.dirname, "..") }).status ?? 1
    else console.log(`import with: ${importer}`)
  }
}
