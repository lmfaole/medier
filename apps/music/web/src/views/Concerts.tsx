// `/konserter`: the concerts of the Konserter calendar, upcoming first (soonest first) and then the ones that have been, newest first.
// A row is «artist, venue» and the day, no time, linking to the concert's page. Plain HTML, no directive.

import { formatDay } from '@designsystem/intl/listening'
import { PageHeader } from '@designsystem/ui/components/page-header'
import { NOTHING_YET } from '@designsystem/ui/lib/empty-states'
import { PageSection } from '@lmfaole/designsystem/components/page-section'
import { Rows } from '@lmfaole/designsystem/components/rows'
import { Stack } from '@lmfaole/designsystem/components/layout'
import { Text } from '@lmfaole/designsystem/components/text'
import type { Where } from '@designsystem/watch/where'

import { ConcertLink } from '@/features/concerts/concert-links'
import { MusicProvider } from '@/features/entities/music-provider'
import { concertLabel } from '@/lib/concert-label'
import type { ConcertSummary, EntitySummary } from '@/lib/types'

const LEAD = 'Konsertene jeg skal på og har vært på, hentet fra billettene.'

/** The concerts in the order a page lists them: the upcoming ones (a group of their own, soonest first), then the ones that have been, newest first. */
type Row = Parameters<typeof Rows>[0]['rows'][number]

interface ConcertGroup {
  label?: string
  rows: Row[]
}

function groupsOf(concerts: readonly ConcertSummary[]): ConcertGroup[] {
  const rowsOf = (list: readonly ConcertSummary[]): Row[] =>
    list.map((concert) => ({ key: concert.slug, body: <ConcertLink slug={concert.slug}>{concertLabel(concert)}</ConcertLink>, trailing: formatDay(concert.on) }))
  const upcoming = concerts.filter((concert) => concert.upcoming).toReversed()
  const seen = concerts.filter((concert) => !concert.upcoming)
  return [
    ...(upcoming.length === 0 ? [] : [{ label: 'Kommende', rows: rowsOf(upcoming) }]),
    ...(seen.length === 0 ? [] : [{ rows: rowsOf(seen) }]),
  ]
}

/** The list of concerts alone, for the page of all of them and for the one of a venue. */
export function ConcertList({ concerts, index, where }: { concerts: ConcertSummary[]; index: EntitySummary[]; where: Where }) {
  const groups = groupsOf(concerts)
  return (
    <MusicProvider index={index} where={where}>
      <Stack gap="lg">
        {groups.length === 0 ? <Text size="sm" tone="muted">{NOTHING_YET}</Text> : null}
        {groups.map((group) =>
          group.label === undefined ? <Rows key="rest" rows={group.rows} /> : (
            <PageSection key={group.label} id={`concerts-${group.label.toLowerCase()}`} title={group.label}>
              <Rows rows={group.rows} />
            </PageSection>
          ),
        )}
      </Stack>
    </MusicProvider>
  )
}

export function Concerts({ concerts, index, where }: { concerts: ConcertSummary[]; index: EntitySummary[]; where: Where }) {
  return (
    <>
      <PageHeader page="music:/konserter" title="Konserter" lead={LEAD} />
      <ConcertList concerts={concerts} index={index} where={where} />
    </>
  )
}
