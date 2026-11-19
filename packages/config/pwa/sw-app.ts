/**
 * The service worker of one installed home app, compiled by `build-sw.ts` to `web/public/sw.js` and so served at `<base>/sw.js`, the address the
 * Nextcloud worker had: the browser updates the installed one in place. It only keeps the last copy of the app's shell so the app starts offline
 * (`sw-app-routes.ts`); it never changes what a page or the API answers. `BUILD_ID` is replaced at build time and names the cache.
 * An app in `PUSH_APPS` (hjem) also shows Nextcloud's Web Push notifications and opens the app when one is tapped (`sw-app-push.ts`); one in `SHARE_APPS`
 * (innboks) takes the Web Share Target POST and finishes Background Fetch uploads (`sw-app-share.ts`).
 */
import { ACTIVATE_URL, pushActionOf, pushEnabled, tagsToClose } from './sw-app-push.ts'
import { inboxStore } from './share-files.ts'
import { finishBackground, isShareRequest, receiveShare, shareEnabled, sharedLocation, type BackgroundOutcome } from './sw-app-share.ts'
import { appOfScope, appStrategyFor, staleCaches } from './sw-app-routes.ts'

declare const self: ServiceWorkerGlobalScope
declare const BUILD_ID: string

const scope = new URL(self.registration.scope)
const app = appOfScope(scope.pathname)
const CACHE = `${app}-shell-${BUILD_ID}`

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(scope.pathname)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of staleCaches(await caches.keys(), app, CACHE)) await caches.delete(name)
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (appStrategyFor({ method: request.method, url: request.url }, scope.origin, scope.pathname) !== 'network-first') return
  event.respondWith(
    fetch(request, { cache: 'no-cache' })
      .then((response) => {
        if (response.ok) {
          const copy = response.clone()
          void caches.open(CACHE).then((cache) => cache.put(request, copy))
        }
        return response
      })
      .catch(async () => (await caches.match(request)) ?? Response.error()),
  )
})

if (pushEnabled(app)) {
  // A push must show something (`userVisibleOnly`): a silent message shows a notification and drops it at once.
  const hidden = async (): Promise<void> => {
    await self.registration.showNotification('…', { tag: 'silent', silent: true })
    for (const notification of await self.registration.getNotifications({ tag: 'silent' })) notification.close()
  }

  self.addEventListener('push', (event) => {
    let message: unknown = null
    try {
      message = event.data?.json() ?? null
    } catch {
      // Not JSON: the generic notification is shown.
    }
    const action = pushActionOf(message)
    event.waitUntil(
      (async () => {
        if (action.kind === 'activate') {
          await fetch(ACTIVATE_URL, { method: 'POST', credentials: 'same-origin', headers: { 'OCS-APIREQUEST': 'true', 'Content-Type': 'application/json' }, body: JSON.stringify({ activationToken: action.token }) })
          return hidden()
        }
        if (action.kind === 'close') {
          const open = await self.registration.getNotifications()
          const tags = new Set(tagsToClose(open.map((notification) => notification.tag), action.ids))
          for (const notification of open) if (tags.has(notification.tag)) notification.close()
          return hidden()
        }
        await self.registration.showNotification(action.title, { tag: action.tag, icon: `${scope.pathname}pwa/icon-192.png`, data: action.data })
      })(),
    )
  })

  self.addEventListener('notificationclick', (event) => {
    event.notification.close()
    event.waitUntil(self.clients.matchAll({ type: 'window' }).then((windows) => (windows[0] ? windows[0].focus() : self.clients.openWindow(scope.pathname))))
  })
}

if (shareEnabled(app)) {
  const store = inboxStore(indexedDB)

  // The page opens at once and the files are received afterwards; the page waits for them in IndexedDB (`receiveShare`).
  self.addEventListener('fetch', (event) => {
    if (!isShareRequest({ method: event.request.method, url: event.request.url }, scope.pathname)) return
    event.respondWith(Response.redirect(sharedLocation(scope.href), 303))
    event.waitUntil(
      receiveShare(event.request, store, async (message) => {
        for (const client of await self.clients.matchAll({ includeUncontrolled: true, type: 'window' })) client.postMessage(message, [])
      }),
    )
  })

  // Background Fetch is not in the DOM typings: its event is an `ExtendableEvent` with the registration of the fetch, and `updateUI` sets the notification's title.
  interface BackgroundFetchEvent extends ExtendableEvent {
    registration: { id: string }
    updateUI(options: { title: string }): Promise<void>
  }
  const isBackgroundFetch = (event: Event): event is BackgroundFetchEvent =>
    event instanceof ExtendableEvent && 'registration' in event && typeof event.registration === 'object' && event.registration !== null && 'id' in event.registration && typeof event.registration.id === 'string' && 'updateUI' in event && typeof event.updateUI === 'function'
  const OUTCOMES: Record<string, BackgroundOutcome> = { backgroundfetchsuccess: 'success', backgroundfetchfail: 'fail', backgroundfetchabort: 'abort' }
  for (const [type, outcome] of Object.entries(OUTCOMES)) {
    self.addEventListener(type, (event) => {
      if (!isBackgroundFetch(event)) return
      event.waitUntil(
        finishBackground(event.registration.id, outcome, store, (url, init) => fetch(url, init)).then(async (title) => {
          if (title !== null) await event.updateUI({ title })
        }),
      )
    })
  }
  self.addEventListener('backgroundfetchclick', (event) => {
    if (event instanceof ExtendableEvent) event.waitUntil(self.clients.openWindow(scope.pathname))
  })
}
