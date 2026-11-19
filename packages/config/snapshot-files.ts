/**
 * Writes a snapshot of an app's API into the directory the build ships as
 * assets (`web/public/`), under the paths `snapshotPath` reads them from. Node
 * only: it is what `scripts/snapshot.ts` runs, never a Worker.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { ApiLoader } from './api-files.ts'
import { jsonProblems } from './json-safe.ts'
import { snapshotPath } from './static-json-files.ts'

/**
 * Replaces `<publicDirectory>/api/` with one file per request URL in `answers`
 * (`/api/charts.json?period=2024`), and returns the paths it wrote. A URL
 * that is no API file is an error: the snapshot would never be served.
 */
export function writeSnapshot(publicDirectory: string, answers: ReadonlyMap<string, unknown>): string[] {
  rmSync(join(publicDirectory, 'api'), { recursive: true, force: true })
  const written: string[] = []
  for (const [request, data] of answers) {
    const path = snapshotPath(new URL(request, 'http://snapshot.invalid'))
    if (path === null) throw new Error(`${request} is not a request the snapshot can serve`)
    const file = join(publicDirectory, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
    written.push(path)
  }
  return written
}

/** What an app adds to its snapshot beyond one bare file per `API` entry: the requests with parameters its page makes. */
export interface SnapshotRequests {
  requests(db: D1Database): Promise<string[]> | string[]
}

/** Every file of `api` without parameters: the requests of an app with none. */
export function bareRequests(api: Record<string, ApiLoader>): string[] {
  return Object.keys(api).map((name) => `/api/${name}.json`)
}

/**
 * The answer of each request in `requests` (`/api/charts.json?period=2024`),
 * built by the app's own `API` loaders. A request that has no answer (`null`,
 * the loader's 404) is left out, as the Worker would 404 it; one that throws
 * is left out too when `onSkip` is given, which hears why, and throws otherwise. An answer that would not read as
 * its type after JSON (`NaN`, a `Date`, a `Map`: `json-safe.ts`) is never skipped, it stops the snapshot: a page that
 * is told `null` where its type says `number` is worse than a snapshot that is not published.
 */
export async function snapshotAnswers(
  api: Record<string, ApiLoader>,
  db: D1Database,
  requests: readonly string[],
  onSkip?: (request: string, reason: string) => void,
): Promise<Map<string, unknown>> {
  const answers = new Map<string, unknown>()
  for (const request of requests) {
    const url = new URL(request, 'http://snapshot.invalid')
    const name = /^\/api\/([a-z0-9-]+)\.json$/.exec(url.pathname)?.[1]
    const load = name === undefined || !Object.hasOwn(api, name) ? undefined : api[name]
    if (load === undefined) throw new Error(`${request} is not a file of the API`)
    let data: unknown
    try {
      data = await load(db, url)
    } catch (error) {
      if (onSkip === undefined) throw error
      onSkip(request, error instanceof Error ? error.message : String(error))
      continue
    }
    if (data === null) {
      onSkip?.(request, 'it has no answer')
      continue
    }
    const problems = jsonProblems(data)
    if (problems.length > 0) throw new Error(`${request} would not read as its type after JSON: ${problems.join('; ')}`)
    answers.set(request, data)
  }
  return answers
}
