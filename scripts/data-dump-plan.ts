/**
 * `npm run data:dump` and `npm run data:restore`, as pure functions on an open database: every non-empty table of a
 * database as a text file of its own (`<table>.jsonl`: the columns on the first line, then one JSON array per row, in
 * the order of the rows), exact enough that restoring them gives back the same values: an integer stays an integer, a
 * real that happens to be whole stays a real, NULL stays NULL, text is not altered and a blob is kept as base64.
 * Text diffs in git, which a SQLite file does not.
 */

import type { DatabaseSync, SQLInputValue } from "node:sqlite"

type Cell = string | number | null | { $int: string } | { $real: number } | { $blob: string } | { $text: string }

const SAFE = BigInt(Number.MAX_SAFE_INTEGER)

/** One value as the file holds it. */
export function encodeCell(value: unknown): Cell {
  if (value === null) return null
  if (typeof value === "bigint") return value <= SAFE && value >= -SAFE ? Number(value) : { $int: value.toString() }
  if (typeof value === "number") return Number.isInteger(value) ? { $real: value } : value
  if (typeof value === "string") return value
  if (value instanceof Uint8Array) return { $blob: Buffer.from(value).toString("base64") }
  throw new Error(`a value of type ${typeof value} is not a SQLite value`)
}

/** One value as the database takes it. A text with a NUL in it comes as its bytes, which `placeholder` turns back into text. */
export function decodeCell(cell: Cell): SQLInputValue {
  if (cell === null || typeof cell === "string") return cell
  if (typeof cell === "number") return Number.isInteger(cell) ? BigInt(cell) : cell
  if ("$int" in cell) return BigInt(cell.$int)
  if ("$real" in cell) return cell.$real
  if ("$text" in cell) return new Uint8Array(Buffer.from(cell.$text, "base64"))
  return new Uint8Array(Buffer.from(cell.$blob, "base64"))
}

/** Node cuts a text at its first NUL, both reading it and binding it, so such a text travels as bytes and is cast back to text. */
export const placeholder = (cell: Cell): string => (typeof cell === "object" && cell !== null && "$text" in cell ? "CAST(? AS TEXT)" : "?")

const quoted = (name: string) => `"${name.replaceAll('"', '""')}"`

/** Every table of a database, empty or not, by name. */
export function tableNames(sqlite: DatabaseSync): string[] {
  return sqlite.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => String(row["name"]))
}

/** The tables of a database that have rows, by name. */
export function filledTables(sqlite: DatabaseSync): string[] {
  const names = tableNames(sqlite)
  return names.filter((name) => sqlite.prepare(`SELECT 1 FROM ${quoted(name)} LIMIT 1`).get() !== undefined)
}

/** The text of one table: the columns, then a line per row, in the table's own order so the same rows are the same text. */
export function dumpTable(sqlite: DatabaseSync, table: string): string {
  const columns = sqlite.prepare(`PRAGMA table_info(${quoted(table)})`).all().map((column) => String(column["name"]))
  // For each column, its bytes when it is a text holding a NUL (node would cut it there), else NULL.
  const bytes = columns.map((column, index) => `CASE WHEN typeof(${quoted(column)}) = 'text' AND instr(CAST(${quoted(column)} AS BLOB), x'00') > 0 THEN CAST(${quoted(column)} AS BLOB) END AS "$nul${index}"`)
  const select = (order: string) => sqlite.prepare(`SELECT *, ${bytes.join(", ")} FROM ${quoted(table)}${order}`)
  let statement
  try {
    statement = select(" ORDER BY rowid")
  } catch {
    // A WITHOUT ROWID table: its rows are in the order of its key, which is the first columns.
    statement = select(` ORDER BY ${columns.map(quoted).join(", ")}`)
  }
  statement.setReadBigInts(true)
  const lines = [JSON.stringify(columns)]
  for (const row of statement.iterate()) {
    lines.push(
      JSON.stringify(
        columns.map((column, index) => {
          const nul = row[`$nul${index}`]
          return nul instanceof Uint8Array ? { $text: Buffer.from(nul).toString("base64") } : encodeCell(row[column])
        }),
      ),
    )
  }
  return `${lines.join("\n")}\n`
}

/** Every filled table's text, by the table's name. */
export function dumpDatabase(sqlite: DatabaseSync): Map<string, string> {
  return new Map(filledTables(sqlite).map((table) => [table, dumpTable(sqlite, table)]))
}

/** Puts a table's text back: the table, which the schema has made (and may have seeded), becomes exactly its rows. Returns how many. */
export function restoreTable(sqlite: DatabaseSync, table: string, text: string): number {
  const [header, ...lines] = text.split("\n").filter((line) => line !== "")
  const columns: unknown = JSON.parse(header ?? "[]")
  if (!Array.isArray(columns) || columns.some((column) => typeof column !== "string")) throw new Error(`${table}: the first line is not the list of columns`)
  sqlite.exec(`DELETE FROM ${quoted(table)}`)
  const inserts = new Map<string, ReturnType<DatabaseSync["prepare"]>>()
  for (const line of lines) {
    const row: unknown = JSON.parse(line)
    if (!Array.isArray(row) || row.length !== columns.length) throw new Error(`${table}: a row does not have ${columns.length} values`)
    const marks = row.map((cell: Cell) => placeholder(cell)).join(", ")
    const insert = inserts.get(marks) ?? sqlite.prepare(`INSERT INTO ${quoted(table)} (${columns.map((column) => quoted(String(column))).join(", ")}) VALUES (${marks})`)
    inserts.set(marks, insert)
    insert.run(...row.map((cell: Cell) => decodeCell(cell)))
  }
  return lines.length
}

/** Makes a database from its schema and its tables' text, in one transaction, and stamps it at `version`. */
export function restoreDatabase(sqlite: DatabaseSync, schema: string, version: number, tables: ReadonlyMap<string, string>): number {
  sqlite.exec(schema)
  sqlite.exec("BEGIN")
  try {
    let rows = 0
    for (const [table, text] of tables) rows += restoreTable(sqlite, table, text)
    sqlite.exec("COMMIT")
    sqlite.exec(`PRAGMA user_version = ${version}`)
    return rows
  } catch (error) {
    sqlite.exec("ROLLBACK")
    throw error
  }
}

/** The rows of each table's text, without the line of columns. */
export function rowCounts(tables: ReadonlyMap<string, string>): Map<string, number> {
  return new Map([...tables].map(([table, text]) => [table, Math.max(0, text.split("\n").filter((line) => line !== "").length - 1)]))
}

/** A table that loses a fifth of its rows, and at least this many, is more likely a broken sync than a clean-up. */
export const SHRINK_MIN_ROWS = 20
export const SHRINK_FRACTION = 0.2

/**
 * The tables whose rows fell sharply (or that vanished) between the dump in git and the database now, as one line each.
 * With `existing` (every table the database has, empty ones too), a table the database no longer has at all is not a loss:
 * only the schema drops a table (a rename, `DROP TABLE IF EXISTS` in db/*.sql), a sync that breaks only empties it.
 */
export function shrunkTables(before: ReadonlyMap<string, number>, after: ReadonlyMap<string, number>, existing?: ReadonlySet<string>): string[] {
  const found: string[] = []
  for (const [table, was] of before) {
    if (existing !== undefined && !existing.has(table)) continue
    const now = after.get(table) ?? 0
    const lost = was - now
    if (lost >= SHRINK_MIN_ROWS && lost > was * SHRINK_FRACTION) found.push(`${table}: ${was} rows in the dump, ${now} in the database`)
  }
  return found
}
