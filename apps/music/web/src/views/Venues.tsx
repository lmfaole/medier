// `/konserter/venuer`: the venues the concerts were at, the most visited first, each a link to its own page. Plain HTML, no directive.

import { formatDay } from '@designsystem/intl/listening'
import { pluralize } from '@designsystem/intl/plural'
import { PageHeader } from '@designsystem/ui/components/page-header'
import { PlaceGrid } from '@designsystem/ui/components/place-grid'
import { pageHref } from '@designsystem/ui/lib/detail-state'
import { NOTHING_YET } from '@designsystem/ui/lib/empty-states'
import { Stack } from '@lmfaole/designsystem/components/layout'
import { Text } from '@lmfaole/designsystem/components/text'

import type { ConcertSummary } from '@/lib/types'
import { venuesOf } from '@/lib/venues'

const LEAD = 'Stedene jeg har vært på konsert, de jeg har vært oftest på først.'

export function Venues({ concerts }: { concerts: ConcertSummary[] }) {
  const venues = venuesOf(concerts)
  return (
    <>
      <PageHeader title="Venuer" lead={LEAD} />
      <Stack gap="lg">
        {venues.length === 0 ? (
          <Text size="sm" tone="muted">{NOTHING_YET}</Text>
        ) : (
          <>
            <Text size="lg">{pluralize(venues.length, { one: '{count} venue', other: '{count} venuer' }, 'nb-NO')}.</Text>
            <PlaceGrid
              places={venues.map((venue) => ({
                name: venue.name,
                href: pageHref({ kind: 'venue', slug: venue.slug }),
                facts: [
                  ['Konserter', String(venue.seen)],
                  ['Kommende', venue.upcoming === 0 ? null : String(venue.upcoming)],
                  ['Første', venue.first === null ? null : formatDay(venue.first)],
                  ['Siste', venue.last === null || venue.last === venue.first ? null : formatDay(venue.last)],
                ],
              }))}
            />
          </>
        )}
      </Stack>
    </>
  )
}
