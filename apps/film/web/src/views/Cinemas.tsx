// `/kinoer`: the cinemas the owner has been to, most visited first. Plain HTML, no directive. A cinema is a card with where it is,
// who runs it, how many visits and films, and the first and last day; its name opens the cinema's own page.

import { formatDay } from '@designsystem/intl/listening'
import { pluralize } from '@designsystem/intl/plural'
import { PageHeader } from '@designsystem/ui/components/page-header'
import { PlaceGrid } from '@designsystem/ui/components/place-grid'
import { pageHref } from '@designsystem/ui/lib/detail-state'
import { NOTHING_YET } from '@designsystem/ui/lib/empty-states'
import { Stack } from '@lmfaole/designsystem/components/layout'
import { Text } from '@lmfaole/designsystem/components/text'

const LEAD = 'Kinoene jeg har vært på, de jeg har vært oftest på først.'

interface CinemaCard {
  name: string
  slug: string
  owner: string | null
  city: string | null
  country: string | null
  image: string | null
  visits: number
  films: number
  first: string | null
  last: string | null
}

export function Cinemas({ data }: { data: { cinemas: CinemaCard[] } }) {
  const visits = data.cinemas.reduce((sum, cinema) => sum + cinema.visits, 0)
  return (
    <>
      <PageHeader title="Kinoer" lead={LEAD} />
      <Stack gap="lg">
        {data.cinemas.length === 0 ? (
          <Text size="sm" tone="muted">{NOTHING_YET}</Text>
        ) : (
          <>
            <Text size="lg">{`${pluralize(data.cinemas.length, { one: '{count} kino', other: '{count} kinoer' }, 'nb-NO')}, ${pluralize(visits, { other: '{count} besøk' }, 'nb-NO')} til sammen.`}</Text>
            <PlaceGrid
              places={data.cinemas.map((cinema) => ({
                name: cinema.name,
                href: pageHref({ kind: 'cinema', slug: cinema.slug }),
                image: cinema.image,
                facts: [
                  ['Sted', [cinema.city, cinema.country].filter(Boolean).join(', ')],
                  ['Drives av', cinema.owner],
                  ['Besøk', `${cinema.visits} (${pluralize(cinema.films, { one: '{count} film', other: '{count} filmer' }, 'nb-NO')})`],
                  ['Første', cinema.first === null ? null : formatDay(cinema.first)],
                  ['Siste', cinema.last === null || cinema.last === cinema.first ? null : formatDay(cinema.last)],
                ],
              }))}
            />
          </>
        )}
      </Stack>
    </>
  )
}
