// `/venue/[slug]`: the page of one venue, as data (`venueModel`) drawn by `EntityView` like every page of one thing. `client:visible`: its tiles count up.

import { EntityView } from '@designsystem/ui/components/entity-view'
import { pageHref } from '@designsystem/ui/lib/detail-state'

import { CONCERT_KIND } from '@/features/concerts/concert-links'
import { venueModel } from '@/features/concerts/concert-model'
import type { ConcertSummary } from '@/lib/types'

export function Venue({ name, concerts }: { name: string; concerts: ConcertSummary[] }) {
  return <EntityView model={venueModel(name, concerts, (slug) => pageHref({ kind: CONCERT_KIND, slug }))} />
}
