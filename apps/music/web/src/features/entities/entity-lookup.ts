// Finding the sheet of a name: the index lists every artist, album and song
// that has one, and a name is only a link where it is in the index.

import type { EntityKind, EntitySummary } from '@/lib/types'

const SEPARATOR = '\u0000'

const keyOf = (kind: EntityKind, name: string, artist: string) => [kind, name, artist].join(SEPARATOR)

export type EntityLookup = (kind: EntityKind, name: string, artist?: string) => EntitySummary | undefined

/** A lookup over `index`; an artist is found by its name alone, an album or a song by its name and its artist. */
export function buildLookup(index: readonly EntitySummary[]): EntityLookup {
  const entries = new Map(index.map((entry) => [keyOf(entry.kind, entry.name, entry.artist), entry]))
  return (kind, name, artist = '') => entries.get(keyOf(kind, name, kind === 'artist' ? '' : artist))
}

const built = new WeakMap<readonly EntitySummary[], EntityLookup>()

/** `buildLookup` once for each index: a page has hundreds of links, and each building the map again froze a phone for seconds. */
export function lookupFor(index: readonly EntitySummary[]): EntityLookup {
  const found = built.get(index) ?? buildLookup(index)
  built.set(index, found)
  return found
}

/** The nothing-has-a-sheet lookup, for while the index loads. */
export const NO_ENTITIES: EntityLookup = () => undefined
