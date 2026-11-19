/**
 * `npm run data:dump`: every local database (`.data/<domain>.db`) as text under `data-dump/<domain>/<table>.jsonl`, which
 * is committed, so the processed data has a history and a second copy that is not on this disk. `npm run data:restore`
 * makes a database from its dump (`db/<domain>.sql` and the rows), and refuses to touch a database that exists. The run
 * log (`platform`) is not dumped: it changes at every run and is worth nothing a day later. The raw exports under
 * `.data/raw/` stay where they are; they are too big, and they are what the dumps are made from.
 *
 * A domain whose table lost a fifth of its rows since the last dump is not written (a broken sync would otherwise
 * replace the good copy); `--allow-shrink` says the loss is meant. A table the database no longer has at all (the schema
 * dropped or renamed it) is not a loss: its file goes, which is what let a rename stop the daily commit.
 *
 *   npm run data:dump [-- <domain>…] [--allow-shrink]
 *   npm run data:restore [-- <domain>… ] [--into <directory>]
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { DATABASES, isDatabaseName, type DatabaseName } from "./data.ts"
import { dumpDatabase, restoreDatabase, rowCounts, shrunkTables, tableNames } from "./data-dump-plan.ts"
import { dumpDirectory as dumpDirectoryOf, readDump } from "./data-dump-files.ts"

const root = join(import.meta.dirname, "..")
const EXCLUDED: readonly DatabaseName[] = ["platform"]
const dumpDirectory = (domain: string) => dumpDirectoryOf(root, domain)

function domainsFrom(names: readonly string[]): DatabaseName[] {
  if (names.length === 0) return DATABASES.filter((domain) => !EXCLUDED.includes(domain))
  return names.map((name) => {
    if (!isDatabaseName(name) || EXCLUDED.includes(name)) throw new Error(`"${name}" is not a database to dump: ${DATABASES.filter((domain) => !EXCLUDED.includes(domain)).join(", ")}`)
    return name
  })
}

function dump(names: readonly string[], allowShrink: boolean): void {
  for (const domain of domainsFrom(names)) {
    const file = join(root, ".data", `${domain}.db`)
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
    mkdirSync(directory, { recursive: true })
    for (const name of readdirSync(directory)) if (!tables.has(name.replace(/\.jsonl$/, ""))) rmSync(join(directory, name))
    let rows = 0
    for (const [table, text] of tables) {
      writeFileSync(join(directory, `${table}.jsonl`), text)
      rows += text.split("\n").length - 2
    }
    console.log(`${domain}: ${tables.size} tables, ${rows} rows`)
  }
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
const into = flag === -1 ? join(root, ".data") : (rest[flag + 1] ?? "")
const names = rest.filter((word, index) => index !== flag && index !== flag + 1 && word !== "--allow-shrink")
if (command === "dump") dump(names, rest.includes("--allow-shrink"))
else if (command === "restore" && into !== "") restore(names, into)
else throw new Error("usage: data-dump.ts dump [<domain>…] | restore [<domain>…] [--into <directory>]")
