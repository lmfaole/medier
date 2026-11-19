/**
 * `npm run data:dump`: every local database (`.data/<domain>.db`) as text under `<dump>/<domain>/<table>.jsonl` (a large table as a
 * folder of chunks, `data-dump-plan.ts`), so the processed data has a history and a second copy that is not on this disk. `<dump>` is
 * `DATA_DUMP_DIR`, a checkout of a **private** repository on GitHub, since this repository is public; `--commit` commits what changed
 * there and `--push` pushes it too. Without `DATA_DUMP_DIR` the dump goes to `data-dump/` here, which git ignores. `npm run data:restore`
 * makes a database from its dump (`db/<domain>.sql` and the rows), and refuses to touch a database that exists. The run
 * log (`platform`) is not dumped: it changes at every run and is worth nothing a day later. The raw exports under
 * `.data/raw/` stay where they are; they are too big, and they are what the dumps are made from.
 *
 * A domain whose table lost a fifth of its rows since the last dump is not written (a broken sync would otherwise
 * replace the good copy); `--allow-shrink` says the loss is meant. A table the database no longer has at all (the schema
 * dropped or renamed it) is not a loss: its file goes, which is what let a rename stop the daily commit.
 *
 *   npm run data:dump [-- <domain>…] [--allow-shrink] [--commit [--push]]
 *   npm run data:restore [-- <domain>… ] [--into <directory>]
 */

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { DATABASES, isDatabaseName, type DatabaseName } from "./data.ts"
import { changedDomains, commitMessage, dumpDatabase, gitIsBusy, restoreDatabase, rowCounts, shrunkTables, tableNames } from "./data-dump-plan.ts"
import { dumpDirectory as dumpDirectoryOf, dumpRoot, readDump, writeDump } from "./data-dump-files.ts"

const root = join(import.meta.dirname, "..")
const EXCLUDED: readonly DatabaseName[] = ["platform"]
const base = dumpRoot(root)
// The databases are where the media server reads them (`DATA_DIR`), `.data/` here by default.
const dataDirectory = process.env["DATA_DIR"] ?? join(root, ".data")
const dumpDirectory = (domain: string) => dumpDirectoryOf(base, domain)

function domainsFrom(names: readonly string[]): DatabaseName[] {
  if (names.length === 0) return DATABASES.filter((domain) => !EXCLUDED.includes(domain))
  return names.map((name) => {
    if (!isDatabaseName(name) || EXCLUDED.includes(name)) throw new Error(`"${name}" is not a database to dump: ${DATABASES.filter((domain) => !EXCLUDED.includes(domain)).join(", ")}`)
    return name
  })
}

function dump(names: readonly string[], allowShrink: boolean): void {
  for (const domain of domainsFrom(names)) {
    const file = join(dataDirectory, `${domain}.db`)
    if (!existsSync(file)) {
      console.log(`${domain}: no ${file}, skipped`)
      continue
    }
    // A sync may be writing while the timer runs; wait for it instead of failing on "database is locked".
    const sqlite = new DatabaseSync(file, { readOnly: true, timeout: 60_000 })
    const tables = dumpDatabase(sqlite)
    const existing = new Set(tableNames(sqlite))
    sqlite.close()
    const directory = dumpDirectory(domain)
    const shrunk = allowShrink ? [] : shrunkTables(rowCounts(readDump(directory)), rowCounts(tables), existing)
    if (shrunk.length > 0) {
      console.log(`${domain}: NOT dumped, rows fell sharply (--allow-shrink if that is meant):\n  ${shrunk.join("\n  ")}`)
      process.exitCode = 1
      continue
    }
    // A database with no rows has no dump.
    if (tables.size === 0) {
      rmSync(directory, { recursive: true, force: true })
      console.log(`${domain}: no rows`)
      continue
    }
    writeDump(directory, tables)
    const rows = [...rowCounts(tables).values()].reduce((sum, count) => sum + count, 0)
    console.log(`${domain}: ${tables.size} tables, ${rows} rows`)
  }
}

/** Commits what the dump changed in its own repository, and pushes it with `push`; nothing while git is busy there or nothing changed. */
function commit(push: boolean): void {
  const git = (...args: string[]) => execFileSync("git", ["-C", base, ...args], { encoding: "utf8" })
  if (!existsSync(join(base, ".git"))) throw new Error(`${base} is no git repository: clone the private data repository there, or set DATA_DUMP_DIR`)
  if (gitIsBusy(readdirSync(join(base, ".git")))) {
    console.log("git is busy in the dump's repository; not committed")
    return
  }
  const domains = changedDomains(git("status", "--porcelain", "--", "."))
  if (domains.length === 0) {
    console.log("nothing changed in the dump")
    return
  }
  git("add", "--all", "--", ".")
  git("commit", "--quiet", "-m", commitMessage(new Date().toISOString().slice(0, 10), domains))
  console.log(`committed: ${domains.join(", ")}`)
  if (push) execFileSync("git", ["-C", base, "push", "--quiet"], { stdio: "inherit" })
}

function restore(names: readonly string[], into: string): void {
  mkdirSync(into, { recursive: true })
  const domains = names.length > 0 ? domainsFrom(names) : DATABASES.filter((domain) => existsSync(dumpDirectory(domain)))
  for (const domain of domains) {
    const target = join(into, `${domain}.db`)
    if (existsSync(target)) {
      console.log(`${domain}: ${target} exists, left as it is`)
      continue
    }
    const directory = dumpDirectory(domain)
    if (!existsSync(directory)) throw new Error(`${domain} has no dump in ${directory}`)
    const tables = readDump(directory)
    const migrations = join(root, "db", "migrations", domain)
    const version = readdirSync(migrations).filter((name) => /^\d{4}-.+\.sql$/.test(name)).length
    const sqlite = new DatabaseSync(target)
    try {
      const rows = restoreDatabase(sqlite, readFileSync(join(root, "db", `${domain}.sql`), "utf8"), version, tables)
      console.log(`${domain}: ${rows} rows restored into ${target}`)
    } catch (error) {
      sqlite.close()
      rmSync(target, { force: true })
      throw error
    }
    sqlite.close()
  }
}

const [command = "", ...rest] = process.argv.slice(2)
const flag = rest.indexOf("--into")
const into = flag === -1 ? dataDirectory : (rest[flag + 1] ?? "")
const names = rest.filter((word, index) => (flag === -1 || (index !== flag && index !== flag + 1)) && !word.startsWith("--"))
if (command === "dump") {
  dump(names, rest.includes("--allow-shrink"))
  // A refused domain (rows fell sharply) keeps its old copy; the rest is still worth committing.
  if (rest.includes("--commit") || rest.includes("--push")) commit(rest.includes("--push"))
}
else if (command === "restore" && into !== "") restore(names, into)
else throw new Error("usage: data-dump.ts dump [<domain>…] | restore [<domain>…] [--into <directory>]")
