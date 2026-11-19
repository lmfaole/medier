/**
 * `npm run data:rehearse`: a new machine's first step, tried on this one. Every database is restored from `data-dump/` into
 * an empty folder, checked, and its rows counted against the dump; then it says how far each is behind the live file.
 * Nothing under `.data/` is touched, and the folder is removed afterwards.
 */

import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { integrityProblems } from "./data-check-plan.ts"
import { dumpDirectory, dumpRoot, readDump } from "./data-dump-files.ts"
import { dumpDatabase, rowCounts } from "./data-dump-plan.ts"
import { DATABASES } from "./data.ts"

const root = join(import.meta.dirname, "..")

/** Tables whose rows differ between two counts, one line each. */
export function countDifferences(expected: ReadonlyMap<string, number>, found: ReadonlyMap<string, number>): string[] {
  return [...new Set([...expected.keys(), ...found.keys()])].toSorted().flatMap((table) => {
    const want = expected.get(table) ?? 0
    const have = found.get(table) ?? 0
    return want === have ? [] : [`${table}: ${want} rows in the dump, ${have} restored`]
  })
}

function rehearse(): string[] {
  const into = mkdtempSync(join(tmpdir(), "rehearse-"))
  const problems: string[] = []
  try {
    const restored = spawnSync(process.execPath, ["--no-warnings", join(root, "scripts", "data-dump.ts"), "restore", "--into", into], { encoding: "utf8" })
    if (restored.status !== 0) return [`restore failed: ${(restored.stderr || restored.stdout).split("\n").find((line) => line.startsWith("Error")) ?? "see the output of data:restore"}`]
    for (const domain of DATABASES.filter((name) => existsSync(dumpDirectory(dumpRoot(root), name)))) {
      const file = join(into, `${domain}.db`)
      if (!readdirSync(into).includes(`${domain}.db`)) {
        problems.push(`${domain}: not restored`)
        continue
      }
      const sqlite = new DatabaseSync(file)
      try {
        const missed = countDifferences(rowCounts(readDump(dumpDirectory(dumpRoot(root), domain))), rowCounts(dumpDatabase(sqlite)))
        problems.push(...[...integrityProblems(sqlite), ...missed].map((line) => `${domain}: ${line}`))
      } finally {
        sqlite.close()
      }
    }
  } finally {
    rmSync(into, { recursive: true, force: true })
  }
  return problems
}

if (import.meta.main) {
  const problems = rehearse()
  console.log(problems.length === 0 ? "every database restores from data-dump/ with the rows the dump holds" : problems.map((line) => `PROBLEM ${line}`).join("\n"))
  process.exitCode = problems.length === 0 ? 0 : 1
}
