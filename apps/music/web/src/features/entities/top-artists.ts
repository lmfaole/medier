// The artists that led a week, a month or a year, each with the picture its page has, for the line «Mest …» under a card.

import type { EntityLookup } from './entity-lookup'

export interface TopArtistPart {
  artist: string
  plays: number
  /** The picture of the artist's page, or none for an artist that has no page or no picture. */
  image: string | null
}

/** The artists in their order, with their counts, and the picture each has in the index. */
export function topArtistParts(top: readonly { artist: string; plays: number }[], lookup: EntityLookup): TopArtistPart[] {
  return top.map(({ artist, plays }) => ({ artist, plays, image: lookup('artist', artist)?.cover ?? null }))
}
