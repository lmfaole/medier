// The three links of a watch-log page, to an item, a person and a place: each to the page of the thing, `/<kind>/<slug>`.

import type { ReactNode } from 'react'
import { pageHref } from '@designsystem/ui/lib/detail-state'
import { ENTITY_LINK } from '@lmfaole/designsystem/lib/link-style'
import { cn } from '@lmfaole/designsystem/lib/utils'

import type { WatchLinks } from './lists.tsx'

/** The kinds the app's cards are named by; `person` is every app's. */
export function watchLinks({ itemKind, placeKind }: { itemKind: string; placeKind: string }): WatchLinks {
  const to = (kind: string) =>
    function CardLink({ slug, children, className, look }: { slug: string; children: ReactNode; className?: string; look?: 'block' }) {
      return (
        <a href={pageHref({ kind, slug })} className={cn(ENTITY_LINK, look === 'block' && 'block no-underline', className)}>
          {children}
        </a>
      )
    }
  return { item: to(itemKind), person: to('person'), place: to(placeKind) }
}
