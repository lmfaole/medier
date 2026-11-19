// A concert as a link to its page (`/konsert/<slug>`), and a venue as a link to its page, with the dotted underline every
// name that has a page shares.

import { pageHref } from '@designsystem/ui/lib/detail-state'
import { appUrl } from '@designsystem/ui/lib/base-url'
import { CardLink } from '@lmfaole/designsystem/components/card-link'


/** The kind of a concert's page: `/konsert/<slug>`. */
export const CONCERT_KIND = 'konsert'

export function ConcertLink({ slug, children }: { slug: string; children: string }) {
  return <CardLink href={pageHref({ kind: CONCERT_KIND, slug })}>{children}</CardLink>
}

export function VenueLink({ slug, children }: { slug: string; children: string }) {
  return <CardLink href={appUrl(`/venue/${slug}`)}>{children}</CardLink>
}
