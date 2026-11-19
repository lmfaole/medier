// The artists that led a week, a month or a year, one under the other, each with its picture as a round avatar, its name as a link and its plays. Plain HTML, no directive.

import { formatCount } from '@designsystem/intl/listening'
import { AvatarList } from '@designsystem/ui/components/avatar-list'

import { ArtistLink } from './entity-links'
import { useEntityLookup } from './entity-context'
import { topArtistParts } from './top-artists'

export function TopArtists({ artists }: { artists: readonly { artist: string; plays: number }[] }) {
  const parts = topArtistParts(artists, useEntityLookup())
  return <AvatarList label="Mest hørt" items={parts.map((part) => ({ key: part.artist, image: part.image, name: <ArtistLink name={part.artist} />, count: formatCount(part.plays) }))} />
}
