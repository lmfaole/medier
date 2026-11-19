/** Where a page is, for the links on it: its path inside the app and the search it was asked with, so a link to a card keeps the list as it is. */

import { DETAIL_PARAM } from '@designsystem/ui/lib/detail-state'
import { appPathOf } from '@designsystem/ui/lib/page-head'

export interface Where {
  path: string
  search: Record<string, string>
}

/** The path and search of a request, without the card it may already name. */
export function whereOf(url: URL): Where {
  const search = new URLSearchParams(url.searchParams)
  search.delete(DETAIL_PARAM)
  return { path: appPathOf(url), search: Object.fromEntries(search) }
}
