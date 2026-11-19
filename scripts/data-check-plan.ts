/**
 * `npm run data:check`, as pure functions on an open database: whether SQLite itself calls the file sound, whether any
 * row points at a row that is not there, and whether the file still has what its `db/<domain>.sql` says. The files
 * are `data-check.ts`'s.
 */

import { DatabaseSync } from "node:sqlite"

/** What SQLite's own checks say is wrong with a database, one line each; nothing means sound. */
export function integrityProblems(sqlite: DatabaseSync): string[] {
  const found: string[] = []
  for (const row of sqlite.prepare("PRAGMA integrity_check").all()) {
    const message = String(Object.values(row)[0])
    if (message !== "ok") found.push(`integrity: ${message}`)
  }
  const dangling = sqlite.prepare("PRAGMA foreign_key_check").all()
  if (dangling.length > 0) found.push(`${dangling.length} row(s) point at a row that is not there (first in table ${String(dangling[0]?.["table"])})`)
  return found
}

function columnsByTable(sqlite: DatabaseSync): Map<string, Set<string>> {
  const tables = sqlite.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((row) => String(row["name"]))
  return new Map(tables.map((table) => [table, new Set(sqlite.prepare(`SELECT name FROM pragma_table_info('${table.replaceAll("'", "''")}')`).all().map((column) => String(column["name"])))]))
}

/** Where the database and `schema` disagree: what the schema makes and the file lacks, and what the file has that the schema does not name (a column added by hand, which a new machine would not get). */
export function schemaDrift(sqlite: DatabaseSync, schema: string): string[] {
  const expected = new DatabaseSync(":memory:")
  try {
    expected.exec(schema)
    const want = columnsByTable(expected)
    const have = columnsByTable(sqlite)
    const found: string[] = []
    for (const [table, columns] of want) {
      const present = have.get(table)
      if (present === undefined) found.push(`table ${table} is missing`)
      else for (const column of columns) if (!present.has(column)) found.push(`${table}.${column} is missing`)
    }
    for (const [table, columns] of have) {
      const named = want.get(table)
      if (named === undefined) found.push(`table ${table} is not in the schema`)
      else for (const column of columns) if (!named.has(column)) found.push(`${table}.${column} is not in the schema`)
    }
    return found
  } finally {
    expected.close()
  }
}
