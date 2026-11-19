// `/artist/<slug>`, `/album/<slug>`, `/song/<slug>`: the page of one thing. `client:visible`: the charts and the long lists.

import type { Where } from '@designsystem/watch/where'
import { EntityBody } from '@/features/entities/entity-body'
import { MusicProvider } from '@/features/entities/music-provider'
import type { ConcertSummary, EntityPage, EntitySummary } from '@/lib/types'

export function Entity({ page, index, where, concerts }: { page: EntityPage; index: EntitySummary[]; where: Where; concerts?: ConcertSummary[] }) {
  return (
    <MusicProvider index={index} where={where}>
      <EntityBody page={page} concerts={concerts} />
    </MusicProvider>
  )
}
