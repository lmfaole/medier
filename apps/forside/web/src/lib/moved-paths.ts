/**
 * Paths that moved. Forside owns `lmfaole.party/*`, so a request for an old path lands on its Worker; `movedTo`
 * says where it went, so a bookmark keeps working. The media apps first got one home under `/medier` and then moved to
 * `sky.lmfaole.party/apps/medier/<app>`, where the page that listed them (`/alle-apper`) became the hub: the old addresses are written here and the new ones come from the registry. A path
 * that never was ours returns `null` and is answered as usual.
 */
import { APP_IDS, APPS, type AppId } from '@designsystem/ui/lib/apps'

/** Where each app used to be on `lmfaole.party`, oldest first: the first home, then `/medier/<name>`. */
const FORMER_PATHS: Readonly<Record<AppId, readonly string[]>> = {
  music: ['/musikk', '/medier/musikk'],
  podkast: ['/podkast', '/medier/podkast'],
  film: ['/film', '/medier/film'],
  tv: ['/medier/tv'],
  games: ['/medier/spill'],
  books: ['/medier/boker'],
  boardgames: ['/medier/brettspill'],
}

/** `[from, to]`: a path that moved and its new home, with the trailing slash the page serves. */
const MOVED: readonly (readonly [string, string])[] = [
  ['/media', '/medier'],
  ['/alle-apper', '/medier'],
  // RSS left the media apps: its old address there sends on to the RSS page of the hjemmeserver app in Nextcloud.
  ['/rss', 'https://sky.lmfaole.party/apps/medier/rss/'],
  ...APP_IDS.flatMap((id) => FORMER_PATHS[id].map((path): [string, string] => [path, APPS[id].href])),
]

/** Where `pathname` went (a path on this host, or a whole address when it left it), or `null` when it did not move. */
export function movedTo(pathname: string): string | null {
  for (const [from, to] of MOVED) {
    if (pathname === from) return to
    if (pathname.startsWith(`${from}/`)) return `${to.replace(/\/$/, '')}${pathname.slice(from.length)}`
  }
  return null
}
