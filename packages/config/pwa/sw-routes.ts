/**
 * What the service worker does with a request, as a pure function so the rules are tested without a browser.
 * `ignore` leaves the request to the browser untouched; the two others name the cache strategy. The worker only
 * ever speeds up and keeps a last copy: it never changes what a page or the API answers, nor their `Cache-Control`.
 */
import { isImmutablePath } from '../security-headers.ts'

export type SwStrategy = 'ignore' | 'cache-first' | 'network-first'

export interface SwRequest {
  method: string
  url: string
  hasRange: boolean
}

/**
 * `base` is the worker's scope without its trailing slash: the hub's mount (`/apps/medier`), with every media app one
 * segment under it (`/apps/medier/film`). So a path is looked at twice, as the hub's own and with its first segment
 * (the app) taken off: `/film/_astro/x.js` is the app's `/_astro/x.js`.
 */
export function strategyFor(request: SwRequest, origin: string, base: string): SwStrategy {
  if (request.method !== 'GET' || request.hasRange) return 'ignore'
  const url = new URL(request.url)
  if (url.origin !== origin || !url.pathname.startsWith(`${base}/`)) return 'ignore'
  const own = url.pathname.slice(base.length)
  const paths = [own, own.replace(/^\/[^/]+(?=\/)/, '')]
  // A server island is a fresh fragment of a page and the worker script is fetched by the browser's own update check.
  if (own === '/sw.js' || paths.some((path) => path.startsWith('/_server-islands/'))) return 'ignore'
  if (paths.some(isImmutablePath)) return 'cache-first'
  return 'network-first'
}

/** A copy worth keeping: a complete, direct answer. A redirect or an error would be replayed offline in place of the page. */
export function isCacheable(response: { status: number; redirected: boolean; type: string }): boolean {
  return response.status === 200 && !response.redirected && response.type === 'basic'
}
