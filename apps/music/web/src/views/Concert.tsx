// `/konsert/<slug>`: the page of one concert. `client:visible`: the photo grid.

import type { Where } from '@designsystem/watch/where'

import { ConcertBody } from '@/features/concerts/concert-body'
import { MusicProvider } from '@/features/entities/music-provider'
import type { ArtistPage, ConcertSummary, EntitySummary } from '@/lib/types'

export function Concert({ concert, artist, index, where }: { concert: ConcertSummary; artist: ArtistPage | null; index: EntitySummary[]; where: Where }) {
  return (
    <MusicProvider index={index} where={where}>
      <ConcertBody concert={concert} artist={artist} />
    </MusicProvider>
  )
}
