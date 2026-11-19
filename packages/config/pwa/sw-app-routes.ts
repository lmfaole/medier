/**
 * What the service worker of one home app does with a request, as a pure function (tested without a browser). It is the worker the hjemmeserver
 * app of Nextcloud had (`js/sw-base.js`): the app's own pages and files are fetched from the network first, with the browser's HTTP cache
 * bypassed, and the last copy is only the fallback offline. Every API call goes straight to the network, so a number on a page is never an old one.
 */

/** `ignore` leaves the request to the browser; `network-first` is the one strategy a home app's shell has. */
export type AppSwStrategy = 'ignore' | 'network-first'

export interface AppSwRequest {
  method: string
  url: string
}

/**
 * `scopePath` is the app's mount with a trailing slash (`/apps/hjemmeserver/penger/`). Only a GET of the app's own origin and path is handled,
 * and not an `/api/` file, a server island (a fresh fragment of a page) or the worker script itself.
 */
export function appStrategyFor(request: AppSwRequest, origin: string, scopePath: string): AppSwStrategy {
  if (request.method !== 'GET') return 'ignore'
  const url = new URL(request.url)
  if (url.origin !== origin || !url.pathname.startsWith(scopePath)) return 'ignore'
  const own = url.pathname.slice(scopePath.length - 1)
  if (own.startsWith('/api/') || own.startsWith('/_server-islands/') || own === '/sw.js') return 'ignore'
  return 'network-first'
}

/** The caches this app kept before (`penger-v1` of the Nextcloud worker, an older build's `penger-shell-<id>`): everything of its prefix but the current one. */
export function staleCaches(names: readonly string[], app: string, current: string): string[] {
  return names.filter((name) => name.startsWith(`${app}-`) && name !== current)
}

/** The app's id from its scope (`/apps/hjemmeserver/penger/` is `penger`). */
export function appOfScope(scopePath: string): string {
  const segments = scopePath.split('/').filter((segment) => segment !== '')
  return segments.at(-1) ?? ''
}
