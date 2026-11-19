/**
 * The data of one home app (`apps/penger`, …), answered from JSON files instead of a database: the same in-process `Fetcher` as
 * `media-data.ts` (`/api/<name>.json?…` to the `API[name]` loader of the app's `web/src/server/api.ts`), for an app whose `DOMAINS` is `[]`.
 *
 * - The files are the exporters' (`Apper/*.json` of the Nextcloud repository, written also as a host copy, `scripts/apper-export.ts` there),
 *   in one folder the server only READS (`APPER_DIR`, mounted read-only). There is no write route and nothing here creates a file.
 * - A name is checked before it is a path (`APPER_FILE_NAME`), the folder is the only place read, and a file over `MAX_FILE_BYTES` is refused.
 * - Every answer is read fresh and sent `Cache-Control: no-store` with no ETag: the exporters rewrite the files every few minutes, the files
 *   are small, and what is behind a login must not be kept by a cache. The app's own valibot schema (`jsonFile`) decides whether a file is
 *   good: a file that does not match is a 502 and a log line, a missing one a 404.
 */

import { readFile, stat } from "node:fs/promises"
import { join, resolve, sep } from "node:path"

import { APPER_FILE_NAME, ApperFileInvalid, type ApperSource, type FileLoader } from "@designsystem/config/apper-files"
import { jsonProblems } from "@designsystem/config/json-safe"
import { apiRequestOf } from "@designsystem/config/static-json-files"

import type { AppData } from "./media-data.ts"

const API_NAME = /^\/api\/([a-z0-9-]+)\.json$/
/** The largest file read: the biggest export is the RSS search index, a few megabytes. */
export const MAX_FILE_BYTES = 32 * 1024 * 1024

const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }

function failure(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: HEADERS })
}

/** The files of one folder as a source: a name that is not a plain relative `.json` path, or a file that is not there, is `null`. */
export function directorySource(directory: string): ApperSource {
  const root = resolve(directory)
  return {
    async read(name) {
      if (!APPER_FILE_NAME.test(name)) return null
      const path = resolve(join(root, name))
      if (!path.startsWith(`${root}${sep}`)) return null
      try {
        if ((await stat(path)).size > MAX_FILE_BYTES) throw new Error(`${name} is over ${MAX_FILE_BYTES} bytes`)
        return await readFile(path, "utf8")
      } catch (error) {
        if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR" || error.code === "EISDIR")) return null
        throw error
      }
    },
  }
}

export interface FilesDataOptions {
  /** The app's directory name (`penger`), for the log. */
  name: string
  /** Where the app is mounted (`/apps/hjemmeserver/penger`): a request under it is answered as if the app sat at the root. */
  base: string
  api: Readonly<Record<string, FileLoader>>
  /** The folder with the exporters' files (`APPER_DIR`). */
  directory: string
  log?: (message: string) => void
}

export function createFilesData({ name, base, api, directory, log = () => {} }: FilesDataOptions): AppData {
  const prefix = base.replace(/\/+$/, "")
  const source = directorySource(directory)

  async function answer(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const inside = prefix !== "" && url.pathname.startsWith(`${prefix}/`) ? url.pathname.slice(prefix.length) : url.pathname
    const asked = apiRequestOf(new URL(`${inside}${url.search}`, url))
    const apiName = asked === null ? undefined : API_NAME.exec(asked.pathname)?.[1]
    // `Object.hasOwn` and not `in`: `constructor` and `toString` are on every object.
    if (asked === null || apiName === undefined || !Object.hasOwn(api, apiName)) return failure(404, `no API file at ${url.pathname}${url.search}`)
    const load = api[apiName]
    if (load === undefined) return failure(404, `no API file ${apiName}`)
    let data: unknown
    try {
      data = await load(source, asked)
    } catch (error) {
      log(`${name}: ${asked.pathname}${asked.search} failed: ${error instanceof Error ? error.message : String(error)}`)
      return error instanceof ApperFileInvalid ? failure(502, "the file does not match what the app expects") : failure(503, "the files are not available")
    }
    if (data === null) return failure(404, "no answer")
    const problems = jsonProblems(data)
    if (problems.length > 0) {
      log(`${name}: ${asked.pathname} would not read as its type after JSON: ${problems.join("; ")}`)
      return failure(500, "the answer is not JSON-safe")
    }
    return new Response(JSON.stringify(data), { status: 200, headers: HEADERS })
  }

  return {
    fetcher: { fetch: answer },
    refresh: () => false,
    generation: () => 0,
    async warm() {},
    close() {},
  }
}
