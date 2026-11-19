/**
 * One media app's data, in its own thread. The loaders are synchronous SQLite, and a cold one (the music capsule) takes seconds, so
 * under the server's own thread it stalled every app; here it stalls only this app. The main thread asks for an answer by its path
 * and gets back the status, the headers that matter and the body (`media-app-host.ts`).
 */

import { parentPort, workerData } from "node:worker_threads"
import * as v from "valibot"

import { databaseEnv, isDatabaseName } from "./data.ts"
import { parseApiModule } from "./media-api-module.ts"
import { createAppData, type AppData } from "./media-data.ts"
import { createFilesData } from "./media-files.ts"

export interface WorkerSetup {
  name: string
  base: string
  /** The app's `web/src/server/api.ts`, as a file URL. */
  apiModule: string
  dataDirectory: string
  /** The migrations of the databases (`db/migrations`). */
  migrationsRoot: string
  /** The folder with the exporters' JSON files, for an app that has no database (`DOMAINS = []`, `media-files.ts`). */
  apperDirectory?: string
  volatile: Readonly<Record<string, number>>
  warm: readonly string[]
}

export interface WorkerAsk {
  id: number
  path: string
  ifNoneMatch: string | null
}

export interface WorkerReply {
  id: number
  status: number
  headers: [string, string][]
  body: string | null
}

const KEPT_HEADERS = ["content-type", "etag", "cache-control"]
const RECHECK_MS = 5000

const SetupSchema = v.object({
  name: v.string(),
  base: v.string(),
  apiModule: v.string(),
  dataDirectory: v.string(),
  migrationsRoot: v.string(),
  apperDirectory: v.optional(v.string()),
  volatile: v.record(v.string(), v.number()),
  warm: v.array(v.string()),
}) satisfies v.GenericSchema<WorkerSetup>

if (parentPort !== null) {
  const port = parentPort
  const setup = v.parse(SetupSchema, v.parse(v.object({ setup: v.unknown() }), workerData).setup)
  const log = (message: string) => port.postMessage({ log: message })
  const loaded = parseApiModule(await import(setup.apiModule))
  let data: AppData
  if (loaded.kind === "files") {
    if (setup.apperDirectory === undefined) throw new Error(`${setup.name}: a file-backed app needs APPER_DIR`)
    data = createFilesData({ name: setup.name, base: setup.base, api: loaded.module.API, directory: setup.apperDirectory, log })
  } else {
    const { API, DOMAINS } = loaded.module
    for (const domain of DOMAINS) if (!isDatabaseName(domain)) throw new Error(`${setup.name}: DOMAINS names "${domain}", which is no database`)
    const fileOf = (domain: string) => (isDatabaseName(domain) ? process.env[databaseEnv(domain)] : undefined) ?? `${setup.dataDirectory}/${domain}.db`
    data = createAppData({
      name: setup.name,
      base: setup.base,
      api: API,
      domains: DOMAINS,
      fileOf,
      platformFile: fileOf("platform"),
      migrationsRoot: setup.migrationsRoot,
      volatile: setup.volatile,
      log,
    })
  }

  // The heavy answers are made now and after each change, not under a visitor.
  if (setup.warm.length > 0) {
    setImmediate(() => void data.warm(setup.warm).catch((error: unknown) => log(`${setup.name}: warm-up failed: ${String(error)}`)))
    setInterval(() => {
      if (data.refresh()) setTimeout(() => void data.warm(setup.warm).catch(() => {}), 1000).unref()
    }, RECHECK_MS).unref()
  }

  port.on("message", async (ask: WorkerAsk) => {
    const headers: Record<string, string> = ask.ifNoneMatch === null ? {} : { "If-None-Match": ask.ifNoneMatch }
    const response = await data.fetcher.fetch(new Request(new URL(ask.path, "http://worker.invalid"), { headers }))
    const reply: WorkerReply = {
      id: ask.id,
      status: response.status,
      headers: KEPT_HEADERS.flatMap((name): [string, string][] => {
        const value = response.headers.get(name)
        return value === null ? [] : [[name, value]]
      }),
      body: response.status === 304 || response.body === null ? null : await response.text(),
    }
    port.postMessage(reply)
  })
  port.postMessage({ ready: true })
}
