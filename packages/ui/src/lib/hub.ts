/**
 * The hub of the media apps: the page that lists them and shows the latest of all of them (`apps/medier`), and the one
 * app a browser installs. Every media app is mounted under it (`/apps/medier/film`), so its mount is the scope of the
 * manifest and of the service worker. It is not in the registry (`apps.ts`): it has no pages of its own to list.
 */
export const HUB = {
  label: "Medier",
  description: "Musikk, film, serier, spill, bøker og mer: alle appene og det siste fra dem.",
  href: "https://sky.lmfaole.party/apps/medier/",
  devPort: 5200,
} as const

/** Where the hub is mounted, without a trailing slash: `/apps/medier`. */
export const HUB_MOUNT = new URL(HUB.href).pathname.replace(/\/+$/, "")

/** The hub's address from a page of any app: its own port while developing, since each app is then a server of its own. */
export const HUB_URL = import.meta.env?.DEV ? `http://localhost:${HUB.devPort}${HUB_MOUNT}/` : `${HUB_MOUNT}/`

/**
 * Scopes that had a service worker of their own before the hub was the one installed app: the eight apps where they
 * were mounted, and the «Medier» page of Nextcloud's hjemmeserver app. A page unregisters what is left of them.
 */
export const RETIRED_SCOPES = ["/apps/musikk/", "/apps/podkast/", "/apps/film/", "/apps/tv/", "/apps/spill/", "/apps/boker/", "/apps/brettspill/", "/apps/rss/", "/apps/hjemmeserver/medier/"] as const
