// `/tilbakeblikk/maaned` and `/tilbakeblikk/aar`: the latest months and every year, one card each, as `/tilbakeblikk/uke` has the weeks. Plain HTML, no directive.

import { PeriodsPage } from '@designsystem/ui/components/periods-page'
import type { Where } from '@designsystem/watch/where'
import { MusicProvider } from '@/features/entities/music-provider'
import { TopArtists } from '@/features/entities/top-artists-list'
import type { EntitySummary, MonthsData, SpanSummary, YearsData } from '@/lib/types'

const entriesOf = (spans: readonly SpanSummary[]) => spans.map((span) => ({ ...span, leaders: span.topArtists.length === 0 ? null : <TopArtists artists={span.topArtists} /> }))

export function Months({ data, index, where }: { data: MonthsData; index: EntitySummary[]; where: Where }) {
  return (
    <MusicProvider index={index} where={where}>
      <PeriodsPage app="music" kind="month" periods={entriesOf(data.months)} />
    </MusicProvider>
  )
}

export function Years({ data, index, where }: { data: YearsData; index: EntitySummary[]; where: Where }) {
  return (
    <MusicProvider index={index} where={where}>
      <PeriodsPage app="music" kind="year" periods={entriesOf(data.years)} />
    </MusicProvider>
  )
}
