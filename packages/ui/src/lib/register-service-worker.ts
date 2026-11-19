import { HUB_MOUNT, RETIRED_SCOPES } from "./hub.ts"

/**
 * Registers the one service worker of the media apps from a page of any of them: the hub's, whose scope is the hub's
 * mount and so every app under it. Not in development, where a worker holding old pages would hide the edit just made.
 * A worker that cannot be fetched (one app served alone, without the hub) is not the page's problem, so nothing is thrown.
 * What an earlier layout registered on its own scope (`RETIRED_SCOPES`) is unregistered on the way. A home app (`own`, its mount with a trailing slash)
 * registers its own worker instead of the hub's.
 */
export async function registerServiceWorker(enabled: boolean, own?: string): Promise<void> {
  if (!enabled || !("serviceWorker" in navigator)) return
  try {
    const retired: readonly string[] = RETIRED_SCOPES
    for (const registration of await navigator.serviceWorker.getRegistrations()) {
      if (retired.includes(new URL(registration.scope).pathname)) await registration.unregister()
    }
    // A home app is installed on its own: its worker is `<own>sw.js`, at the address its installed copies already hold, with the app's mount as scope.
    const scope = own ?? `${HUB_MOUNT}/`
    await navigator.serviceWorker.register(`${scope}sw.js`, { scope })
  } catch {
    // Offline or no hub on this host: the page works without a worker.
  }
}
