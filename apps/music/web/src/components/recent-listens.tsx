// The last listens, newest first, as the rows of the front page's latest list.

import { formatClock } from '@designsystem/intl/listening'
import type { MediaRow } from '@designsystem/ui/components/media-rows'
import { details } from '@designsystem/ui/lib/details'
import { AlbumLink, ArtistLink, SongLink } from '@/features/entities/entity-links'
import type { RecentListen } from '@/lib/types'

export function recentListenRows(listens: readonly RecentListen[]): MediaRow[] {
  return listens.map((listen) => ({
    key: `${listen.at}-${listen.track}`,
    cover: listen.cover,
    title: <SongLink track={listen.track} artist={listen.artist} />,
    subtitle: details([<ArtistLink key="artist" name={listen.artist} />, listen.release === null ? null : <AlbumLink key="album" album={listen.release} artist={listen.artist} />]),
    when: formatClock(listen.at),
  }))
}
