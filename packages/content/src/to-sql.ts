/**
 * The rows of every collection as SQL for the local database: the local seed
 * and the tests. Each table is emptied first, so running it again replaces the
 * rows instead of adding to them.
 */

import { sqlLiteral } from "@designsystem/config/sql-dump"

import { COLLECTIONS } from "./collections.ts"
import { tableName } from "./tables.ts"
import type { Row } from "./row-schema.ts"

function cell(value: unknown): string {
  return sqlLiteral(typeof value === "object" && value !== null ? JSON.stringify(value) : value)
}

export function contentRowsSql(rowsByType: ReadonlyMap<string, readonly Row[]>): string {
  const lines = [`-- The sample content as rows of the local database. Replaces whatever the content tables hold.`, ""]
  for (const collection of COLLECTIONS) {
    const table = tableName(collection)
    const keys = collection.fields.map((field) => field.key)
    lines.push(`DELETE FROM ${table};`)
    for (const row of rowsByType.get(collection.type) ?? []) {
      lines.push(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map((key) => cell(row[key])).join(", ")});`)
    }
    lines.push("")
  }
  return lines.join("\n")
}
