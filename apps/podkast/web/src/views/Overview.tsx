// `/`: the way into the other pages and the latest plays. Plain HTML, no directive.

import { formatClock } from '@designsystem/intl/listening'
import { FrontPage } from '@designsystem/ui/components/front-page'
import type * as v from 'valibot'

import type { RESPONSES } from '@/server/responses'

export function Overview({ data }: { data: v.InferOutput<typeof RESPONSES.overview> }) {
  return (
    <FrontPage
      app="podkast"
      title="Podkast"
      lead="Det jeg hører på: Spotify-eksporten og det som er scrobblet siden."
      latest={{
        title: 'Sist spilt',
        rows: data.recent.map((play) => ({ key: `${play.at}/${play.episode}`, cover: play.cover, title: play.episode, subtitle: play.show, when: formatClock(play.at) })),
      }}
    />
  )
}
