/**
 * Writes one app's snapshot: the answer of every `/api/<file>.json` its page
 * asks for, built by the app's own `API` loaders from the local databases and
 * written to `web/public/api/`, where the build ships it as static assets. A
 * deployed Worker has no database; this is what it serves.
 *
 * Each domain has a SQLite file of its own (`.data/<domain>.db`). An app names the
 * domains its API reads (`DOMAINS` in its `server/api.ts`): the first is its database,
 * the others are attached under their own name, so a loader says `github.github_days`
 * for a table of a second one. Every domain first gets its schema (every statement is
 * IF NOT EXISTS), so a collection with no rows yet is an empty list and not a missing table.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { pathToFileURL } from "node:url"
import { DatabaseSync } from "node:sqlite"
import * as v from "valibot"

import type { ApiLoader } from "@designsystem/config/api-files"
import { readFreshness } from "./freshness-plan.ts"
import { databaseEnv, isDatabaseName, type DatabaseName } from "./data.ts"
import { sqliteAsD1 } from "@designsystem/config/sqlite-d1"
import { bareRequests, snapshotAnswers, writeSnapshot, type SnapshotRequests } from "@designsystem/config/snapshot-files"

const MIGRATIONS_ROOT = join("db", "migrations")
const MIGRATION_FILE = /^\d{4}-.+\.sql$/
const VERSION_ROW = v.object({ user_version: v.number() })
const TABLE_COUNT_ROW = v.object({ tables: v.number() })

const ApiModule = v.object({
  API: v.record(v.string(), v.custom<ApiLoader>((value) => typeof value === "function")),
  DOMAINS: v.pipe(v.array(v.string()), v.minLength(1)),
})
const SnapshotModule = v.object({ snapshot: v.custom<SnapshotRequests>((value) => typeof value === "object" && value !== null && "requests" in value) })

export interface SnapshotOptions {
  /** `apps/<name>`. */
  appDirectory: string
  /** The repository root, where `db/` and `.data/` are. */
  rootDirectory: string
  /** Database files by domain; `.data/<domain>.db`, or the domain's variable, unless a test says otherwise. */
  databaseFiles?: Readonly<Record<string, string>>
  /** The folder with one migrations folder per domain; `db/migrations` unless a test says otherwise. */
  migrationsRoot?: string
  /** Where `api/` is written; the app's `web/public` unless a test says otherwise. */
  publicDirectory?: string
  log?: (message: string) => void
}

/**
 * A database with tables but a lower version than the latest migration has not been migrated, and is refused; an empty
 * one gets the whole schema below and is stamped at the latest version, as the Rust tools stamp a fresh file, so it is not
 * "behind" the next time.
 */
function prepareDomain(domain: DatabaseName, file: string, migrationsRoot: string, schemaFile: string): void {
  const sqlite = new DatabaseSync(file)
  try {
    // A tool may be writing the file; wait for it instead of failing with "locked".
    sqlite.exec("PRAGMA busy_timeout = 5000")
    const [version] = v.parse(v.array(VERSION_ROW), sqlite.prepare("PRAGMA user_version").all())
    const [counted] = v.parse(v.array(TABLE_COUNT_ROW), sqlite.prepare("SELECT count(*) AS tables FROM sqlite_schema WHERE type = 'table'").all())
    const latest = readdirSync(join(migrationsRoot, domain)).filter((name) => MIGRATION_FILE.test(name)).length
    const empty = (counted?.tables ?? 0) === 0
    if (!empty && (version?.user_version ?? 0) < latest) {
      throw new Error(`the database is at version ${version?.user_version ?? 0} and the latest migration is ${latest}: run npm run data:migrate first`)
    }
    sqlite.exec(readFileSync(schemaFile, "utf8"))
    if (empty) sqlite.exec(`PRAGMA user_version = ${latest}`)
  } finally {
    sqlite.close()
  }
}

const FRESHNESS_FILE = "api/oppdatert.json"

/**
 * `api/oppdatert.json`: when the app's sync last ran well and how many rows it added, read from the run log. Only
 * that, never a job or an error. An app with no sync, or a run log that is not there or not migrated, has no file.
 */
function writeFreshness(publicDirectory: string, appName: string, runLogFile: string, log: (message: string) => void): string[] {
  if (!existsSync(runLogFile)) return []
  const runLog = new DatabaseSync(runLogFile, { readOnly: true })
  try {
    runLog.exec("PRAGMA busy_timeout = 5000")
    const freshness = readFreshness(runLog, appName)
    if (freshness === null) return []
    mkdirSync(join(publicDirectory, "api"), { recursive: true })
    writeFileSync(join(publicDirectory, FRESHNESS_FILE), `${JSON.stringify(freshness, null, 2)}\n`)
    return [`/${FRESHNESS_FILE}`]
  } catch (error) {
    log(`  skipped ${FRESHNESS_FILE}: ${error instanceof Error ? error.message : String(error)}`)
    return []
  } finally {
    runLog.close()
  }
}

export async function snapshotApp({ appDirectory, rootDirectory, databaseFiles = {}, migrationsRoot = join(rootDirectory, MIGRATIONS_ROOT), publicDirectory = join(appDirectory, "web", "public"), log = () => {} }: SnapshotOptions): Promise<string[]> {
  const server = join(appDirectory, "web", "src", "server")
  const { API, DOMAINS } = v.parse(ApiModule, await import(pathToFileURL(join(server, "api.ts")).href))
  const domains = DOMAINS.map((name): DatabaseName => {
    if (!isDatabaseName(name)) throw new Error(`${appDirectory}: DOMAINS names "${name}", which is no database`)
    return name
  })
  const fileOf = (domain: DatabaseName) => databaseFiles[domain] ?? process.env[databaseEnv(domain)] ?? join(rootDirectory, ".data", `${domain}.db`)
  for (const domain of domains) prepareDomain(domain, fileOf(domain), migrationsRoot, join(rootDirectory, "db", `${domain}.sql`))
  const [primary, ...others] = domains
  if (primary === undefined) throw new Error(`${appDirectory}: DOMAINS is empty`)
  const sqlite = new DatabaseSync(fileOf(primary))
  try {
    sqlite.exec("PRAGMA busy_timeout = 5000")
    // The names are registry names (letters only); the path is quoted for SQL.
    for (const domain of others) sqlite.exec(`ATTACH DATABASE '${fileOf(domain).replaceAll("'", "''")}' AS ${domain}`)
    // Only music and the dashboard have requests with parameters; the rest is one bare file per API entry.
    const extra = await import(pathToFileURL(join(server, "snapshot.ts")).href).then(
      (module) => v.parse(SnapshotModule, module).snapshot,
      (error: unknown) => (error instanceof Error && "code" in error && error.code === "ERR_MODULE_NOT_FOUND" ? null : Promise.reject(error)),
    )
    const db = sqliteAsD1(sqlite)
    const requests = extra === null ? bareRequests(API) : await extra.requests(db)
    const answers = await snapshotAnswers(API, db, requests, (request, reason) => log(`  skipped ${request}: ${reason}`))
    const written = writeSnapshot(publicDirectory, answers)
    const runLogFile = databaseFiles["platform"] ?? process.env[databaseEnv("platform")] ?? join(rootDirectory, ".data", "platform.db")
    return [...written, ...writeFreshness(publicDirectory, basename(appDirectory), runLogFile, log)]
  } finally {
    sqlite.close()
  }
}
