/**
 * The dump as it lies on disk: `<dump>/<domain>/<table>.jsonl`, or `<dump>/<domain>/<table>/0001.jsonl` and on for a large table (`tableFiles`).
 * `<dump>` is `DATA_DUMP_DIR` when it is set — a checkout of a private repository on GitHub, since this one is public — and `data-dump/` here
 * otherwise, which `.gitignore` keeps out of this repository.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"

import { joinTable, tableFiles } from "./data-dump-plan.ts"

export function dumpRoot(root: string, env: Readonly<Record<string, string | undefined>> = process.env): string {
  const chosen = env["DATA_DUMP_DIR"]
  if (chosen === undefined || chosen === "") return join(root, "data-dump")
  return isAbsolute(chosen) ? chosen : resolve(root, chosen)
}

export const dumpDirectory = (base: string, domain: string): string => join(base, domain)

const numbered = (directory: string): string[] => readdirSync(directory).filter((name) => /^\d{4}\.jsonl$/.test(name)).toSorted()

/** Each table's text, by the table's name, whether it lies in one file or in a folder of chunks. */
export function readDump(directory: string): Map<string, string> {
  if (!existsSync(directory)) return new Map()
  const tables = new Map<string, string>()
  for (const name of readdirSync(directory).toSorted()) {
    const path = join(directory, name)
    if (name.endsWith(".jsonl")) tables.set(name.replace(/\.jsonl$/, ""), readFileSync(path, "utf8"))
    else if (statSync(path).isDirectory()) tables.set(name, joinTable(numbered(path).map((file) => readFileSync(join(path, file), "utf8"))))
  }
  return tables
}

/** Writes the tables as files, removing every file or folder of the domain that the new dump does not have (a dropped table, a shrunk one). */
export function writeDump(directory: string, tables: ReadonlyMap<string, string>): void {
  mkdirSync(directory, { recursive: true })
  const files = new Map([...tables].flatMap(([table, text]) => tableFiles(table, text)))
  const kept = new Set([...files.keys()].map((path) => path.split("/")[0] ?? path))
  for (const name of readdirSync(directory)) if (!kept.has(name)) rmSync(join(directory, name), { recursive: true, force: true })
  for (const [path, text] of files) {
    const target = join(directory, path)
    // A table that grew past the size of one file leaves its single file for a folder, and back again when it shrinks.
    if (path.includes("/")) rmSync(join(directory, `${dirname(path)}.jsonl`), { force: true })
    else rmSync(join(directory, path.replace(/\.jsonl$/, "")), { recursive: true, force: true })
    mkdirSync(dirname(target), { recursive: true })
    if (!existsSync(target) || readFileSync(target, "utf8") !== text) writeFileSync(target, text)
  }
  for (const [table] of tables) {
    const folder = join(directory, table)
    if (!existsSync(folder) || !statSync(folder).isDirectory()) continue
    const wanted = new Set([...files.keys()].filter((path) => path.startsWith(`${table}/`)).map((path) => path.slice(table.length + 1)))
    for (const name of readdirSync(folder)) if (!wanted.has(name)) rmSync(join(folder, name), { force: true })
  }
}
