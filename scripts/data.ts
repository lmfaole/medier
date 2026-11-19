/**
 * `npm run data:describe`: a plain-text map of what is in each local database
 * under `.data/`, one SQLite file per data domain, on this machine. `npm run data:status`:
 * when each timer-run job last ran. `npm run data:query -- <database> "<SELECT …>"`: a few rows
 * of one read-only question, as a table, instead of a one-off script. Nothing here reaches a network.
 */

import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import * as v from "valibot"

import { lastRuns, scheduledRuns, STALE_AFTER_HOURS, staleRuns, UNFINISHED_AFTER_HOURS, type JobSchedule, type LastRun } from "./run-log.ts"
import { loadJobSchedule } from "./job-periods.ts"

/** The local databases there are: `.data/<name>.db`. */
export const DATABASES = ["music", "podcasts", "podcast_history", "github", "cv", "accounts", "photos", "site", "film", "tv", "games", "books", "boardgames", "platform"] as const

export type DatabaseName = (typeof DATABASES)[number]

/** The variable that moves a database file: `MUSIC_DB`, `GITHUB_DB`, … and `PODCAST_DB` for podcasts. */
export function databaseEnv(name: DatabaseName): string {
  return name === "podcasts" ? "PODCAST_DB" : `${name.toUpperCase()}_DB`
}

const TableName = v.object({ name: v.string() })
const ColumnInfo = v.object({ name: v.string(), type: v.string(), notnull: v.number(), pk: v.number() })
const RowCount = v.object({ count: v.number() })

export function isDatabaseName(name: string): name is DatabaseName {
  return DATABASES.some((known) => known === name)
}

/**
 * Every table with its columns and row count, as the text an agent reads first.
 * Column comments live in `db/<name>.sql`; this is what the file itself holds.
 */
export function describeDatabase(sqlite: DatabaseSync, name: string, only?: string): string {
  const tables = v
    .parse(
      v.array(TableName),
      sqlite.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all(),
    )
    .filter((table) => only === undefined || table.name === only)
  if (only !== undefined && tables.length === 0) throw new Error(`${name} has no table "${only}"`)
  const lines = [`# ${name}`]
  for (const { name: table } of tables) {
    const columns = v.parse(v.array(ColumnInfo), sqlite.prepare(`PRAGMA table_info("${table}")`).all())
    const [counted] = v.parse(v.array(RowCount), sqlite.prepare(`SELECT count(*) AS count FROM "${table}"`).all())
    lines.push("", `## ${table} (${counted?.count ?? 0} rows)`)
    for (const column of columns) {
      const flags = [column.pk > 0 ? "primary key" : "", column.notnull > 0 ? "not null" : ""].filter(Boolean).join(", ")
      lines.push(`- ${column.name} ${column.type.toLowerCase()}${flags === "" ? "" : ` (${flags})`}`)
    }
  }
  return lines.join("\n")
}

/** One line per job, newest run first by source; a missing or old run says STALE. */
export function formatStatus(all: readonly LastRun[], now: Date, schedule?: JobSchedule): string {
  if (all.length === 0) return "No timer run recorded yet (node scripts/sync-timers.ts <app> install)."
  const runs = schedule === undefined ? all : scheduledRuns(all, schedule)
  const stale = new Set(staleRuns(runs, now, STALE_AFTER_HOURS, UNFINISHED_AFTER_HOURS, schedule))
  return runs
    .map((run) => {
      const outcome = run.finishedAt === null ? "unfinished" : run.ok ? "ok" : "FAILED"
      return `${run.source} ${run.job}: ${outcome}, started ${run.startedAt}${stale.has(run) ? "  STALE" : ""}`
    })
    .join("\n")
}

const DEFAULT_ROWS = 50
const CELL_WIDTH = 60
const PRAGMAS = /^pragma\s+(table_info|table_list|index_list|foreign_key_list)\b/i

/** One statement that only reads: SELECT, WITH or a PRAGMA that describes. The file is opened read-only as well. */
export function assertReadOnlySql(sql: string): string {
  const statement = sql.trim().replace(/;\s*$/, "")
  if (statement === "" || statement.includes(";")) throw new Error("expected exactly one statement")
  if (!/^(select|with)\b/i.test(statement) && !PRAGMAS.test(statement)) throw new Error("only SELECT, WITH and PRAGMA table_info/table_list/index_list are allowed")
  if (/\battach\b/i.test(statement)) throw new Error("ATTACH is not allowed")
  return statement
}

function cell(value: unknown): string {
  const text = value === null ? "NULL" : typeof value === "string" ? value : String(value)
  const flat = text.replace(/\s+/g, " ")
  return flat.length > CELL_WIDTH ? `${flat.slice(0, CELL_WIDTH - 1)}…` : flat
}

/** Rows as a pipe-separated table, cut to `limit` rows with a last line saying more were there. */
export function formatRows(rows: readonly Record<string, unknown>[], limit: number): string {
  if (rows.length === 0) return "(no rows)"
  const shown = rows.slice(0, limit)
  const columns = Object.keys(shown[0] ?? {})
  const lines = [columns.join(" | "), ...shown.map((row) => columns.map((column) => cell(row[column])).join(" | "))]
  if (rows.length > limit) lines.push(`… more than ${limit} rows; add LIMIT or narrow the WHERE`)
  return lines.join("\n")
}

/** Runs one read-only statement and returns at most `limit` rows, plus one to know whether there were more. */
export function runQuery(sqlite: DatabaseSync, sql: string, limit = DEFAULT_ROWS): string {
  const rows: Record<string, unknown>[] = []
  for (const row of sqlite.prepare(assertReadOnlySql(sql)).iterate()) {
    rows.push(row)
    if (rows.length > limit) break
  }
  return formatRows(rows, limit)
}

function selected(names: string[]): DatabaseName[] {
  if (names.length === 0) return [...DATABASES]
  return names.map((name) => {
    if (!isDatabaseName(name)) throw new Error(`unknown database "${name}", expected one of ${DATABASES.join(", ")}`)
    return name
  })
}

if (import.meta.filename === process.argv[1]) {
  const [command = "", ...names] = process.argv.slice(2)
  const directory = join(import.meta.dirname, "..", ".data")
  try {
    if (command === "status") {
      const sqlite = new DatabaseSync(join(directory, "platform.db"), { readOnly: true })
      console.log(formatStatus(lastRuns(sqlite), new Date(), loadJobSchedule(join(directory, ".."))))
      sqlite.close()
    } else if (command === "describe") {
      const [first = "", table] = names
      const targets: [DatabaseName, string | undefined][] =
        table !== undefined && isDatabaseName(first) ? [[first, table]] : selected(names).map((database) => [database, undefined])
      for (const [database, only] of targets) {
        const sqlite = new DatabaseSync(join(directory, `${database}.db`), { readOnly: true })
        console.log(describeDatabase(sqlite, database, only))
        sqlite.close()
      }
    } else if (command === "query") {
      const [database = "", sql = ""] = names
      if (!isDatabaseName(database)) throw new Error(`usage: data:query -- <${DATABASES.join("|")}> "<SELECT …>"`)
      const sqlite = new DatabaseSync(join(directory, `${database}.db`), { readOnly: true })
      console.log(runQuery(sqlite, sql))
      sqlite.close()
    } else {
      throw new Error('expected "describe", "query" or "status"')
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = process.exitCode ?? 1
  }
}
