/**
 * The service worker of an installed app, compiled by `build-sw.ts` to `web/public/sw.js`. It keeps the last copy of
 * what was opened so the app starts offline; the routing rules are `sw-routes.ts`. `BUILD_ID` is replaced at build time
 * and names the cache, so a new deploy drops the old copies instead of mixing them.
 */
import { isCacheable, strategyFor } from './sw-routes.ts'

declare const self: ServiceWorkerGlobalScope
declare const BUILD_ID: string

const CACHE = `pwa-${BUILD_ID}`
const scope = new URL(self.registration.scope)
const base = scope.pathname.replace(/\/+$/, '')

async function remember(request: Request, response: Response): Promise<void> {
  if (isCacheable(response)) await (await caches.open(CACHE)).put(request, response)
}

async function networkFirst(request: Request): Promise<Response> {
  try {
    const response = await fetch(request)
    // A clone goes to the cache after the page has its answer, so keeping a copy never delays it.
    const copy = response.clone()
    void remember(request, copy)
    return response
  } catch (error) {
    const cache = await caches.open(CACHE)
    // An address never opened offline falls back to the app's front page rather than the browser's error page.
    const kept = (await cache.match(request)) ?? (request.mode === 'navigate' ? await cache.match(scope.pathname) : undefined)
    if (kept === undefined) throw error
    return kept
  }
}

async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE)
  const kept = await cache.match(request)
  if (kept !== undefined) return kept
  const response = await fetch(request)
  void remember(request, response.clone())
  return response
}

self.addEventListener('install', () => {
  void self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name)
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const strategy = strategyFor({ method: request.method, url: request.url, hasRange: request.headers.has('range') }, scope.origin, base)
  if (strategy === 'cache-first') event.respondWith(cacheFirst(request))
  else if (strategy === 'network-first') event.respondWith(networkFirst(request))
})

/** What a push carries (`scripts/music-digest.ts`): the words, the page it leads to (a path on this origin) and a tag, so a newer one of a kind replaces the older. */
interface PushPayload {
  title: string
  body: string
  path: string
  tag?: string
}

function payloadOf(data: PushMessageData | null): PushPayload | undefined {
  try {
    const parsed: unknown = data?.json()
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const { title, body, path, tag }: Record<string, unknown> = Object.fromEntries(Object.entries(parsed))
    if (typeof title !== 'string' || typeof body !== 'string' || typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return undefined
    return { title, body, path, ...(typeof tag === 'string' ? { tag } : {}) }
  } catch {
    return undefined
  }
}

self.addEventListener('push', (event) => {
  const payload = payloadOf(event.data)
  if (payload === undefined) return
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: `${base}/pwa/icon-192.png`,
      badge: `${base}/pwa/icon-192.png`,
      data: { path: payload.path },
      ...(payload.tag === undefined ? {} : { tag: payload.tag }),
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data: unknown = event.notification.data
  const path: unknown = typeof data === 'object' && data !== null && 'path' in data ? data.path : undefined
  if (typeof path !== 'string') return
  const target = new URL(path, scope.origin)
  if (target.origin !== scope.origin) return
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const here = open.find((client) => new URL(client.url).origin === scope.origin)
      if (here !== undefined && 'navigate' in here) {
        await here.focus()
        await here.navigate(target.href)
      } else await self.clients.openWindow(target.href)
    })(),
  )
})
