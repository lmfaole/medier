/**
 * Where a page stands: its path without the app's base and its search without an old card's `?kort=` (the media server
 * sends such an address to the thing's page before it gets here).
 */

import { BASE_URL } from '@designsystem/ui/lib/base-url'
import { DETAIL_PARAM } from '@designsystem/ui/lib/detail-state'

export interface Here {
  /** `/historikk`; `/` for the front page. */
  path: string
  search: Record<string, string>
}

/** `url` is the page's own address. `base` is the app's (`/apps/spill/`), the build's by default. */
export function hereOf(url: URL, base: string = BASE_URL): Here {
  const root = base.replace(/\/+$/, '')
  const rest = root !== '' && (url.pathname === root || url.pathname.startsWith(`${root}/`)) ? url.pathname.slice(root.length) : url.pathname
  const search = Object.fromEntries([...url.searchParams].filter(([name]) => name !== DETAIL_PARAM))
  return { path: rest === '' ? '/' : rest, search }
}
