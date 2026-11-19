// `/historikk?month=YYYY-MM`: every listen of one month, newest first, in the shared history page. Plain HTML, no directive.

import { formatClock } from '@designsystem/intl/listening'
import { pluralize } from '@designsystem/intl/plural'
import { HistoryPage } from '@designsystem/ui/components/history-page'
import { details } from '@designsystem/ui/lib/details'
import type { Where } from '@designsystem/watch/where'
import { MusicProvider } from '@/features/entities/music-provider'
import { AlbumLink, ArtistLink, SongLink } from '@/features/entities/entity-links'
import type { EntitySummary, HistoryData } from '@/lib/types'

export function History({ data, index, where }: { data: HistoryData; index: EntitySummary[]; where: Where }) {
  return (
    <MusicProvider index={index} where={where}>
      <HistoryPage
        app="music"
        period={{ kind: 'month', selected: data.month, periods: data.months }}
        listTitle="Alle avspillinger"
        summary={`${pluralize(data.listens.length, { one: '{count} avspilling', other: '{count} avspillinger' }, 'nb-NO')}.`}
        rows={data.listens.map((listen, position) => ({
          key: `${listen.at}/${listen.track}/${position}`,
          cover: listen.cover,
          title: <SongLink key="song" track={listen.track} artist={listen.artist} />,
          subtitle: details([<ArtistLink key="artist" name={listen.artist} />, listen.release === null ? null : <AlbumLink key="album" album={listen.release} artist={listen.artist} />]),
          when: formatClock(listen.at),
        }))}
      />
    </MusicProvider>
  )
}
