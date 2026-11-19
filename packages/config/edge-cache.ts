/**
 * Edge cache (Workers' own cache, or a small one in memory where there is none: the Node server of the media apps) for the API answers a Worker builds from its
 * local database while it runs under development: an answer is built once per
 * cache key and served from the cache after that. Nothing invalidates a key —
 * the rows change offline, and `version` (an app's `DATA_VERSION`) is what
 * moves the whole cache forward when they do.
 *
 * Only 200 responses are stored.
 */

const NAMESPACE = '/__edge-cache'

/** What `withEdgeCache` needs of a cache: Workers' `caches.default` has it, and so has the in-memory one. */
interface SmallCache {
  match(request: Request): Promise<Response | undefined>
  put(request: Request, response: Response): Promise<void>
}

const MEMORY_ENTRIES = 2000

/** For a process with no `caches`: bodies kept whole, the oldest dropped first. */
function createMemoryCache(): SmallCache {
  const kept = new Map<string, { status: number; headers: [string, string][]; body: Uint8Array<ArrayBuffer> }>()
  return {
    async match(request) {
      const entry = kept.get(request.url)
      return entry === undefined ? undefined : new Response(entry.body, { status: entry.status, headers: entry.headers })
    },
    async put(request, response) {
      kept.set(request.url, { status: response.status, headers: [...response.headers], body: new Uint8Array(await response.arrayBuffer()) })
      for (const oldest of kept.keys()) {
        if (kept.size <= MEMORY_ENTRIES) break
        kept.delete(oldest)
      }
    },
  }
}

const memoryCache = createMemoryCache()

/**
 * The query string is part of the key, because an API answers differently
 * per parameter; dropping it served every period the first one cached.
 * Parameters are sorted so their order cannot split one answer across two
 * keys.
 */
export function cacheKey(url: URL, version: number): Request {
  const key = new URL(url)
  key.searchParams.sort()
  key.hash = ''
  key.pathname = `${NAMESPACE}/v${version}${url.pathname}`
  return new Request(key.toString(), { method: 'GET' })
}

/** Serves from `build()`, with the edge cache in between. */
export async function withEdgeCache(url: URL, version: number, build: () => Promise<Response>): Promise<Response> {
  const cache: SmallCache = typeof caches === 'undefined' ? memoryCache : caches.default
  const key = cacheKey(url, version)

  const hit = await cache.match(key)
  if (hit) return withMarker(hit, 'HIT')

  const response = await build()
  if (response.status !== 200) return response

  try {
    await cache.put(key, response.clone())
  } catch (error) {
    console.error(`edge cache: could not store ${url.pathname}: ${error instanceof Error ? error.message : String(error)}`)
  }

  return withMarker(response, 'MISS')
}

function withMarker(response: Response, status: 'HIT' | 'MISS'): Response {
  const marked = new Response(response.body, { status: response.status, headers: new Headers(response.headers) })
  marked.headers.set('X-Edge-Cache', status)
  return marked
}
