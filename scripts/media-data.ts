/**
 * The data of one media app, answered from the local databases per request instead of from a snapshot: an in-process
 * `Fetcher` (the seam `staticJsonFiles` and `readSnapshot` ask the asset store through) that maps `/api/<name>.json?…` to the
 * `API[name]` loader of the app's `web/src/server/api.ts`.
 *
 * - The databases are opened read-only (the app's own first, the others attached `mode=ro`, as `snapshot-app.ts` attaches them)
 *   and never written: no schema is applied, and a database behind the latest migration is refused.
 * - Only names in `API` are served, only with parameters `SAFE_PARAMETER` allows; a loader that answers `null` or throws is a 404,
 *   and an answer that would not read back as its type after JSON (`json-safe.ts`) is a 500, as it stops a snapshot.
 * - A *generation* is the size and modification time of the database files, their `-wal` and the run log, looked at once a
 *   second at most. When it changes the connection and its `sqliteAsD1` wrapper are made anew (the loaders keep their
 *   once-per-database reads in a `WeakMap` keyed by that wrapper, so they start over) and the cache of answers is emptied.
 * - Answers are kept as text with an ETag, so a browser's revalidation is a 304; an answer that depends on the clock
 *   (`toppsaker`) expires on its own, and every answer after `defaultTtlMs`.
 */

import { createHash } from "node:crypto"
import { existsSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

import type { ApiLoader } from "@designsystem/config/api-files"
import { jsonProblems } from "@designsystem/config/json-safe"
import { sqliteAsD1 } from "@designsystem/config/sqlite-d1"
import { apiRequestOf } from "@designsystem/config/static-json-files"

import { readFreshness } from "./freshness-plan.ts"

const MIGRATION_FILE = /^\d{4}-.+\.sql$/
const FRESHNESS_NAME = "oppdatert"
const API_NAME = /^\/api\/([a-z0-9-]+)\.json$/

export interface AppDataOptions {
  /** The app's directory name (`film`): the key of its run-log entry for `oppdatert.json`. */
  name: string
  /** Where the app is mounted (`/apps/film`): a request under it is answered as if the app sat at the root. */
  base: string
  api: Readonly<Record<string, ApiLoader>>
  /** `DOMAINS` of the app's `server/api.ts`: the first is its database, the others are attached under their own name. */
  domains: readonly string[]
  fileOf(domain: string): string
  /** The run log (`platform.db`), for `oppdatert.json`. */
  platformFile: string
  /** The folder with one migrations folder per domain (`db/migrations`). */
  migrationsRoot: string
  /** How long an answer lives, in milliseconds, per API name; the clock-dependent ones. */
  volatile?: Readonly<Record<string, number>>
  defaultTtlMs?: number
  /** How often the files are looked at. */
  checkEveryMs?: number
  /** What the answers kept may weigh together, in characters. */
  maxCacheSize?: number
  now?: () => number
  log?: (message: string) => void
}

export interface AppData {
  fetcher: Fetcher
  /** Looks at the files (at most once per `checkEveryMs`); `true` when they changed since the last look. */
  refresh(): boolean
  /** Changes with every change of the files. */
  generation(): number
  /** Asks for each request (`/api/capsule.json?month=2026-10`) in turn, so the first visitor does not pay for the loader. */
  warm(requests: readonly string[]): Promise<void>
  close(): void
}

interface Connection {
  sqlite: DatabaseSync
  runLog: DatabaseSync | null
  db: D1Database
}

interface Kept {
  body: string
  etag: string
  expires: number
}

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" }

function failure(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...JSON_HEADERS, "Cache-Control": "no-store" } })
}

/** `"…"` over the text, so the same answer is the same tag across restarts. */
function etagOf(body: string): string {
  return `"${createHash("sha1").update(body).digest("base64url").slice(0, 22)}"`
}

function matches(ifNoneMatch: string | null, etag: string): boolean {
  if (ifNoneMatch === null) return false
  return ifNoneMatch.split(",").some((tag) => tag.trim() === "*" || tag.trim().replace(/^W\//, "") === etag)
}

/** The number of migration files of a domain, which is the `user_version` a migrated database has. */
function latestMigration(migrationsRoot: string, domain: string): number {
  const folder = join(migrationsRoot, domain)
  return existsSync(folder) ? readdirSync(folder).filter((name) => MIGRATION_FILE.test(name)).length : 0
}

function stamp(file: string): string {
  try {
    const status = statSync(file)
    return `${status.mtimeMs}:${status.size}`
  } catch {
    return "-"
  }
}

export function createAppData({
  name,
  base,
  api,
  domains,
  fileOf,
  platformFile,
  migrationsRoot,
  volatile = {},
  defaultTtlMs = 10 * 60_000,
  checkEveryMs = 1000,
  maxCacheSize = 64_000_000,
  now = Date.now,
  log = () => {},
}: AppDataOptions): AppData {
  const prefix = base.replace(/\/+$/, "")
  const files = [...domains.map(fileOf), platformFile].flatMap((file) => [file, `${file}-wal`])
  const answers = new Map<string, Kept>()
  const running = new Map<string, Promise<Kept | Response>>()
  let size = 0
  let connection: Connection | undefined
  let seen = ""
  let checkedAt = Number.NEGATIVE_INFINITY
  let counter = 0

  function dropAnswers(): void {
    answers.clear()
    running.clear()
    size = 0
  }

  /** The old connection is closed a while later, not now: a request that started with it may still be reading. */
  function retire(old: Connection | undefined): void {
    if (old === undefined) return
    setTimeout(() => {
      old.sqlite.close()
      old.runLog?.close()
    }, 60_000).unref()
  }

  function refresh(): boolean {
    if (now() - checkedAt < checkEveryMs) return false
    checkedAt = now()
    const current = files.map(stamp).join("|")
    if (current === seen) return false
    const first = seen === ""
    seen = current
    retire(connection)
    connection = undefined
    dropAnswers()
    counter += 1
    return !first
  }

  function open(): Connection {
    const [primary, ...others] = domains
    if (primary === undefined) throw new Error(`${name}: DOMAINS is empty`)
    const sqlite = new DatabaseSync(fileOf(primary), { readOnly: true })
    try {
      // A tool may be writing the file; wait for it instead of failing with "locked".
      sqlite.exec("PRAGMA busy_timeout = 5000")
      for (const domain of others) sqlite.exec(`ATTACH DATABASE 'file:${fileOf(domain).replaceAll("'", "''")}?mode=ro' AS ${domain}`)
      for (const [index, domain] of domains.entries()) {
        const schema = index === 0 ? "main" : domain
        const version = Number(sqlite.prepare(`PRAGMA ${schema}.user_version`).get()?.["user_version"] ?? 0)
        const tables = Number(sqlite.prepare(`SELECT count(*) AS tables FROM ${schema}.sqlite_schema WHERE type = 'table'`).get()?.["tables"] ?? 0)
        const latest = latestMigration(migrationsRoot, domain)
        if (tables > 0 && version < latest) throw new Error(`the ${domain} database is at version ${version} and the latest migration is ${latest}: run npm run data:migrate first`)
      }
    } catch (error) {
      sqlite.close()
      throw error
    }
    let runLog: DatabaseSync | null = null
    if (existsSync(platformFile)) {
      runLog = new DatabaseSync(platformFile, { readOnly: true })
      runLog.exec("PRAGMA busy_timeout = 5000")
    }
    return { sqlite, runLog, db: sqliteAsD1(sqlite) }
  }

  function connect(): Connection {
    connection ??= open()
    return connection
  }

  /** The answer of one request as text, or a status for a 404. */
  async function compute(apiName: string, request: URL): Promise<{ body: string } | { status: number; message: string }> {
    const { db, runLog } = connect()
    if (apiName === FRESHNESS_NAME && !Object.hasOwn(api, apiName)) {
      const freshness = runLog === null ? null : readFreshness(runLog, name)
      return freshness === null ? { status: 404, message: "no run recorded" } : { body: JSON.stringify(freshness) }
    }
    const load = api[apiName]
    if (load === undefined) return { status: 404, message: `no API file ${apiName}` }
    let data: unknown
    try {
      data = await load(db, request)
    } catch (error) {
      log(`${name}: ${request.pathname}${request.search} skipped: ${error instanceof Error ? error.message : String(error)}`)
      return { status: 404, message: "no answer" }
    }
    if (data === null) return { status: 404, message: "no answer" }
    const problems = jsonProblems(data)
    if (problems.length > 0) {
      log(`${name}: ${request.pathname}${request.search} would not read as its type after JSON: ${problems.join("; ")}`)
      return { status: 500, message: "the answer is not JSON-safe" }
    }
    return { body: JSON.stringify(data) }
  }

  function keep(key: string, apiName: string, body: string): Kept {
    const kept: Kept = { body, etag: etagOf(body), expires: now() + (volatile[apiName] ?? defaultTtlMs) }
    answers.set(key, kept)
    size += body.length
    // The oldest answers go first when the cache is over its budget (a Map iterates in insertion order).
    for (const [oldKey, old] of answers) {
      if (size <= maxCacheSize || oldKey === key) break
      answers.delete(oldKey)
      size -= old.body.length
    }
    return kept
  }

  function reply(kept: Kept, request: Request): Response {
    const headers = { ETag: kept.etag, "Cache-Control": "private, no-cache" }
    if (matches(request.headers.get("If-None-Match"), kept.etag)) return new Response(null, { status: 304, headers })
    return new Response(kept.body, { status: 200, headers: { ...JSON_HEADERS, ...headers } })
  }

  async function answer(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const inside = prefix !== "" && url.pathname.startsWith(`${prefix}/`) ? url.pathname.slice(prefix.length) : url.pathname
    const asked = apiRequestOf(new URL(`${inside}${url.search}`, url))
    const apiName = asked === null ? undefined : API_NAME.exec(asked.pathname)?.[1]
    if (asked === null || apiName === undefined) return failure(404, `no API file at ${url.pathname}${url.search}`)
    // `Object.hasOwn` and not `in`: `constructor` and `toString` are on every object.
    if (!Object.hasOwn(api, apiName) && apiName !== FRESHNESS_NAME) return failure(404, `no API file ${apiName}`)

    refresh()
    const key = `${asked.pathname}${asked.search}`
    const kept = answers.get(key)
    if (kept !== undefined && kept.expires > now()) return reply(kept, request)

    let pending = running.get(key)
    if (pending === undefined) {
      const generation = counter
      const started = (async (): Promise<Kept | Response> => {
        let result: Awaited<ReturnType<typeof compute>>
        try {
          result = await compute(apiName, asked)
        } catch (error) {
          log(`${name}: ${key} failed: ${error instanceof Error ? error.message : String(error)}`)
          return failure(503, "the database is not available")
        }
        if ("status" in result) return failure(result.status, result.message)
        // Not kept when the files changed while it was being made: the next request asks again.
        return generation === counter ? keep(key, apiName, result.body) : { body: result.body, etag: etagOf(result.body), expires: 0 }
      })().finally(() => {
        if (running.get(key) === started) running.delete(key)
      })
      pending = started
      running.set(key, pending)
    }
    const result = await pending
    // Two requests that shared one computation each answer for themselves: the If-None-Match is theirs.
    return result instanceof Response ? result.clone() : reply(result, request)
  }

  return {
    fetcher: { fetch: answer },
    refresh,
    generation: () => counter,
    async warm(requests) {
      for (const path of requests) await answer(new Request(new URL(`${prefix}${path}`, "http://warm.invalid")))
    },
    close() {
      retire(connection)
      connection = undefined
    },
  }
}
