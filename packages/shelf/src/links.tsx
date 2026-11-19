// A work's link in a list: to the work's own page (`/spill/<slug>`, `/bok/<slug>`, `/brettspill/<slug>`).

import type { SlugLink } from '@lmfaole/designsystem/components/item-link'
import { pageHref } from '@designsystem/ui/lib/detail-state'

export function workLink(kind: string): SlugLink {
  return function WorkLink({ slug, children, className, look }) {
    return (
      <a href={pageHref({ kind, slug })} className={look === 'block' ? `block no-underline ${className ?? ''}`.trim() : className}>
        {children}
      </a>
    )
  }
}
