/**
 * What the media server knows about each of the apps it mounts (the eight media apps and their hub, and the home apps of `HOME_SPECS`): where it sits, which of its pages moved, which answers
 * go stale on their own and what to ask for in the background after the data changed. The base paths are the apps' own
 * (`astro.config.ts`; `media-registry.test.ts` compares the two), and the build is `apps/<name>/web/dist`.
 */

import { join } from "node:path"

import { MOVED_FILM_PAGES, MOVED_MUSIC_PAGES, MOVED_SHELF_PAGES, MOVED_WATCH_PAGES } from "@designsystem/config/moved-pages"

import { appMountPath, HOME_APP_IDS } from "@designsystem/ui/lib/apps"

import { HOME_APP_NAMES, HUB_APP, MEDIA_APPS } from "./apps.ts"

export interface MediaAppSpec {
  name: string
  /** Where the app is mounted, without a trailing slash. */
  base: string
  /** Pages that have a new address (`moved-pages.ts`): a path under the base mapped to the new one. */
  moved: Readonly<Record<string, string>>
  /** The API files whose answer depends on the clock, and how long it may be kept (milliseconds). */
  volatile?: Readonly<Record<string, number>>
  /** Asked for when the data changes and at start-up: the loader that blocks the server for seconds when it is cold. */
  warm?: readonly string[]
}

const HUB_BASE = "/apps/medier"

export const SPECS: readonly MediaAppSpec[] = [
  { name: "music", base: "/apps/medier/musikk", moved: MOVED_MUSIC_PAGES },
  { name: "podkast", base: "/apps/medier/podkast", moved: MOVED_WATCH_PAGES },
  { name: "film", base: "/apps/medier/film", moved: MOVED_FILM_PAGES },
  { name: "tv", base: "/apps/medier/tv", moved: MOVED_WATCH_PAGES },
  { name: "games", base: "/apps/medier/spill", moved: MOVED_SHELF_PAGES },
  { name: "books", base: "/apps/medier/boker", moved: MOVED_SHELF_PAGES },
  { name: "boardgames", base: "/apps/medier/brettspill", moved: MOVED_SHELF_PAGES },
  // The hub: every other base is under it, so the router picks the longest base that holds a path.
  { name: HUB_APP, base: HUB_BASE, moved: {} },
]

/**
 * The home apps (innboks, hjem, miniflux, penger), at the addresses their installed PWAs have, `/apps/hjemmeserver/<name>`. Kept apart from `SPECS`:
 * the server mounts one only when it has code (`media-server.ts`), and `MOVED_BASES` and the hub are about the media apps alone. Their data is files
 * (`DOMAINS = []`, `media-files.ts`), found by the app's own `server/api.ts`.
 */
export const HOME_SPECS: readonly MediaAppSpec[] = HOME_APP_IDS.map((id) => ({ name: id, base: appMountPath(id), moved: {} }))

/**
 * Where the apps were before they moved under the hub (`/apps/film`), each mapped to its base now: the router answers 301
 * with the rest of the path, so a bookmark and an installed copy of the old app land on the new address.
 */
export const MOVED_BASES: Readonly<Record<string, string>> = Object.fromEntries(
  SPECS.filter((spec) => spec.name !== HUB_APP).map((spec) => [spec.base.replace(`${HUB_BASE}/`, "/apps/"), spec.base]),
)

/**
 * Apps that left the media server, each mapped to where their page is now: the router answers 301 to that address for any
 * path under them, ahead of the hub that would otherwise answer 404. RSS is the RSS page of the hjemmeserver app in Nextcloud.
 */
export const RETIRED_BASES: Readonly<Record<string, string>> = {
  "/apps/medier/rss": "/apps/hjemmeserver/miniflux/",
  "/apps/rss": "/apps/hjemmeserver/miniflux/",
}

/**
 * The one path rule of the Cloudflare tunnel (Zero Trust, set by hand once) that sends a path of `sky.lmfaole.party` to `http://media:3000`; everything else goes to
 * Nextcloud. Go (RE2) syntax: no lookahead, no backreference. `hjemmeserver` is the whole prefix of the home apps, because the server proxies the paths it does not
 * mount to Nextcloud (`media-proxy.ts`); the legacy slugs stay only to answer their 301s. Nothing is ever added: `docs/MEDIA-SERVER.md` writes it verbatim and
 * `media-registry.test.ts` checks it against every base.
 */
export const TUNNEL_PATH_REGEX = "^/apps/(medier|hjemmeserver|musikk|podkast|film|tv|spill|boker|brettspill|rss)(/|$)"

if (SPECS.map((spec) => spec.name).join() !== MEDIA_APPS.join()) throw new Error("media-registry.ts and MEDIA_APPS (apps.ts) list different apps")

if (HOME_SPECS.map((spec) => spec.name).join() !== HOME_APP_NAMES.join()) throw new Error("HOME_APP_IDS (the registry) and HOME_APP_NAMES (apps.ts) list different apps")

export const buildOf = (rootDirectory: string, name: string): { server: string; client: string } => ({
  server: join(rootDirectory, "apps", name, "web", "dist", "server", "entry.mjs"),
  client: join(rootDirectory, "apps", name, "web", "dist", "client"),
})
