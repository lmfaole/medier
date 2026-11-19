/**
 * The content as tables of the local database: one per collection, named
 * after its type (`cvPosition` → `cv_position`), one column per key of
 * the row the apps read. A list or an object is JSON text in its column. The
 * tables are written from the specs into one generated file per database,
 * `db/cv.sql` and `site.sql` (`npm run generate
 * --workspace @designsystem/content`), and `tables.test.ts` fails when one is out of date.
 */

import { COLLECTIONS } from "./collections.ts"
import type { Collection, ContentDatabase, Field } from "./spec.ts"

/** The content databases, in the order they are written. */
export const CONTENT_DATABASES: readonly ContentDatabase[] = ["cv", "site"]

/** `cvPosition` → `cv_position`. */
export function tableName(collection: Collection): string {
  return collection.type.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

function sqlType(field: Field): string {
  if (field.kind === "integer") return "INTEGER"
  if (field.kind === "number") return "REAL"
  return "TEXT"
}

function columnLine(collection: Collection, field: Field): string {
  const primary = field.key === collection.idField
  const required = !field.nullable && !field.optional
  const flags = primary ? " PRIMARY KEY" : required ? " NOT NULL" : ""
  const json = field.kind === "list" || field.kind === "object" ? ", JSON" : ""
  return `  ${field.key} ${sqlType(field)}${flags}, -- ${field.title}${json}`
}

function createTable(collection: Collection): string {
  const lines = collection.fields.map((field) => columnLine(collection, field))
  // SQLite takes no comma after the last column, and the comment after it stays.
  const last = lines.length - 1
  lines[last] = (lines[last] ?? "").replace(", --", " --")
  return `-- ${collection.title}.\nCREATE TABLE IF NOT EXISTS ${tableName(collection)} (\n${lines.join("\n")}\n);`
}

/** The whole of `db/<database>.sql`: it holds nothing but the tables of its collections. */
export function contentSchemaSql(database: ContentDatabase): string {
  const header = `-- Schema of \`.data/${database}.db\`, written from the collection specs in packages/content/src/collections\n-- by \`npm run generate --workspace @designsystem/content\`; edit a collection there, not here. Every\n-- statement is idempotent. A changed or dropped column is a numbered migration in \`db/migrations/${database}/\`.`
  const tables = COLLECTIONS.filter((collection) => collection.database === database).map(createTable)
  return `${header}\n\n${tables.join("\n\n")}\n`
}

/** The SELECT that reads a collection's rows, columns in the row's key order. */
export const SELECTS: Readonly<Record<string, string>> = Object.fromEntries(
  COLLECTIONS.map((collection) => [collection.type, `SELECT ${collection.fields.map((field) => field.key).join(", ")} FROM ${tableName(collection)}`]),
)
