// `/`: the way into the other pages and the newest listens. Plain HTML, no directive.

import { FrontPage } from '@designsystem/ui/components/front-page'
import { pageHeader } from '@designsystem/ui/lib/og-pages'
import type { Where } from '@designsystem/watch/where'
import { recentListenRows } from '@/components/recent-listens'
import { MusicProvider } from '@/features/entities/music-provider'
import type { EntitySummary, RecentListen } from '@/lib/types'

export function Overview({ listens, index, where }: { listens: RecentListen[]; index: EntitySummary[]; where: Where }) {
  const header = pageHeader('music:/')

  return (
    <MusicProvider index={index} where={where}>
      <FrontPage
        app="music"
        title={header.title ?? 'Musikk'}
        {...(header.lead === undefined ? {} : { lead: header.lead })}
        latest={{ title: 'Nylig spilt', rows: recentListenRows(listens) }}
      />
    </MusicProvider>
  )
}
