/**
 * `npm run data:check`: whether each local database is sound (SQLite's own integrity and foreign-key checks) and still has
 * every table and column its `db/<domain>.sql` makes. Reads only; the exit status is non-zero when any is not.
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { integrityProblems, schemaDrift } from "./data-check-plan.ts"
import { DATABASES } from "./data.ts"

const root = join(import.meta.dirname, "..")

/** The problems of every database that exists, one line each, led by the domain. */
export function checkAll(): { checked: number; problems: string[] } {
  const problems: string[] = []
  let checked = 0
  for (const domain of DATABASES) {
    const file = join(root, ".data", `${domain}.db`)
    if (!existsSync(file)) continue
    // A sync may be writing while the timer runs; wait for it instead of failing on "database is locked".
    const sqlite = new DatabaseSync(file, { readOnly: true, timeout: 60_000 })
    try {
      checked += 1
      const schema = join(root, "db", `${domain}.sql`)
      const found = [...integrityProblems(sqlite), ...(existsSync(schema) ? schemaDrift(sqlite, readFileSync(schema, "utf8")) : [])]
      problems.push(...found.map((line) => `${domain}: ${line}`))
    } finally {
      sqlite.close()
    }
  }
  return { checked, problems }
}

if (import.meta.main) {
  const { checked, problems } = checkAll()
  console.log(problems.length === 0 ? `${checked} databases are sound and match their schemas` : problems.map((line) => `PROBLEM ${line}`).join("\n"))
  process.exitCode = problems.length === 0 ? 0 : 1
}
