/**
 * An app's JSON API served from files in the asset store, for a Worker that
 * has no database: `scripts/snapshot.ts` writes each answer into
 * `web/public/api/` before the build, and this serves them.
 *
 * A request with parameters has its own file, named after them
 * (`/api/charts.json?period=2024` is `/api/charts/period=2024.json`), so the
 * snapshot has to list the combinations the page asks for; anything else is a
 * 404, never the shell's HTML.
 */

import { jsonResponse } from './json-response.ts'
import { CACHE_API, SECURITY_HEADERS } from './security-headers.ts'

const API_FILE = /^\/api\/([a-z0-9-]+)\.json$/
const SAFE_PARAMETER = /^[A-Za-z0-9._-]+$/

/**
 * The asset path that holds the answer to `url`, or `null` for a path that is
 * no API file or a parameter that cannot be part of a file name.
 */
export function snapshotPath(url: URL): string | null {
  const name = API_FILE.exec(url.pathname)?.[1]
  if (name === undefined) return null
  const parameters = [...url.searchParams.entries()].toSorted(([a], [b]) => a.localeCompare(b))
  if (parameters.length === 0) return url.pathname
  if (parameters.some(([key, value]) => !SAFE_PARAMETER.test(key) || !SAFE_PARAMETER.test(value))) return null
  return `/api/${name}/${parameters.map(([key, value]) => `${key}=${value}`).join(',')}.json`
}

const SNAPSHOT_FILE = /^\/api\/([a-z0-9-]+)\/(.+)\.json$/

/**
 * The API request a path asks for, whichever way it is written: `/api/charts.json?period=2024` itself, or the snapshot file
 * name of it, `/api/charts/period=2024.json` (what `snapshotPath` makes and `staticJsonFiles` asks the store for). The result
 * is always the first form with its parameters sorted, or `null` for a path that is no API file or a parameter outside
 * `SAFE_PARAMETER`. A server that answers from the databases reads the file name back into the request its loader wants.
 */
export function apiRequestOf(url: URL): URL | null {
  const bare = API_FILE.exec(url.pathname)?.[1]
  const file = SNAPSHOT_FILE.exec(url.pathname)
  const name = bare ?? file?.[1]
  if (name === undefined) return null
  let parameters: [string, string][]
  if (bare === undefined) {
    // A file name carries its parameters, so a query beside it is a second, contradicting source.
    if (url.search !== '') return null
    parameters = (file?.[2] ?? '').split(',').map((part): [string, string] => {
      const at = part.indexOf('=')
      return at === -1 ? ['', part] : [part.slice(0, at), part.slice(at + 1)]
    })
  } else {
    parameters = [...url.searchParams.entries()]
  }
  if (parameters.some(([key, value]) => !SAFE_PARAMETER.test(key) || !SAFE_PARAMETER.test(value))) return null
  const target = new URL(`/api/${name}.json`, url)
  for (const [key, value] of parameters.toSorted(([a], [b]) => a.localeCompare(b))) target.searchParams.append(key, value)
  return target
}

export interface StaticJsonFilesOptions {
  /** The asset store, read lazily: on Workers, `env.ASSETS` from `cloudflare:workers`. */
  assets: () => Fetcher
  /** Defaults to `SECURITY_HEADERS`. */
  headers?: Record<string, string>
  /** A 200's `Cache-Control`. Defaults to `CACHE_API`. */
  cacheControl?: string
  /** The prefix the asset store keeps its files under (`/apps/film`): Vite's dev server keeps the base, a built `dist/client` does not. Defaults to none. */
  assetBase?: string
}

/** A `GET` handler answering `/api/<name>.json` from the snapshot in the asset store. */
export function staticJsonFiles({
  assets,
  headers = SECURITY_HEADERS,
  cacheControl = CACHE_API,
  assetBase = '',
}: StaticJsonFilesOptions): (args: { request: Request }) => Promise<Response> {
  return async ({ request }) => {
    const url = new URL(request.url)
    const path = snapshotPath(url)
    if (path === null) return jsonResponse({ error: `no API file at ${url.pathname}${url.search}` }, headers, 404)

    const response = await assets().fetch(new Request(new URL(`${assetBase}${path}`, url), { headers: { Accept: 'application/json' } }))
    // A missing file comes back as the shell's HTML with a 200, so the content type decides.
    if (!response.ok || !(response.headers.get('Content-Type') ?? '').includes('application/json')) {
      await response.body?.cancel()
      return jsonResponse({ error: `no snapshot for ${url.pathname}${url.search}` }, headers, 404)
    }
    const merged = new Headers(headers)
    merged.set('Content-Type', 'application/json; charset=utf-8')
    merged.set('Cache-Control', cacheControl)
    return new Response(response.body, { status: 200, headers: merged })
  }
}
