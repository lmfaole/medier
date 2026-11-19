/** A JSON answer with the Worker's headers and the API cache rule. */

import { CACHE_API } from './security-headers.ts'

/** JSON with the given headers and the API cache rule, which is `no-store` for anything but a 200. */
export function jsonResponse(data: unknown, headers: Record<string, string>, status = 200, cacheControl = CACHE_API): Response {
  const merged = new Headers(headers)
  merged.set('Content-Type', 'application/json; charset=utf-8')
  // Only a 200 is worth keeping; a 404 or a 503 held by the browser would outlive the thing that caused it.
  merged.set('Cache-Control', status === 200 ? cacheControl : 'no-store')
  return new Response(JSON.stringify(data, null, 2), { status, headers: merged })
}
