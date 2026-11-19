// `/tilbakeblikk/uke`: the latest weeks, one card each: its number, its plays with the change from the week before as an icon, and the artists that led, under each other. Plain HTML, no directive.

import { PeriodsPage } from '@designsystem/ui/components/periods-page'
import type { Where } from '@designsystem/watch/where'
import { MusicProvider } from '@/features/entities/music-provider'
import { TopArtists } from '@/features/entities/top-artists-list'
import type { EntitySummary, WeeksData } from '@/lib/types'

export function Weeks({ data, index, where }: { data: WeeksData; index: EntitySummary[]; where: Where }) {
  return (
    <MusicProvider index={index} where={where}>
      <PeriodsPage app="music" kind="week" periods={data.weeks.map((week) => ({ ...week, leaders: week.topArtists.length === 0 ? null : <TopArtists artists={week.topArtists} /> }))} />
    </MusicProvider>
  )
}
