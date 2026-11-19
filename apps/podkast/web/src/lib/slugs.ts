/**
 * Which names in a page's text have a page of their own. The index (`entities.json`) lists every show and episode, which is
 * far more than a page names, so a page takes only the part its data mentions: plain objects, since they cross to an island.
 */

export interface IndexedEntity {
  kind: 'show' | 'episode'
  slug: string
  name: string
  show: string | null
}

/** The slugs by name: a show by its name, an episode by its show and its name. */
export interface Slugs {
  shows: Record<string, string>
  episodes: Record<string, string>
}

export const episodeKey = (show: string, name: string) => `${show}\u0000${name}`

function stringsIn(value: unknown, into: Set<string>): Set<string> {
  if (typeof value === 'string') into.add(value)
  else if (Array.isArray(value)) for (const item of value) stringsIn(item, into)
  else if (typeof value === 'object' && value !== null) for (const item of Object.values(value)) stringsIn(item, into)
  return into
}

/** The slugs of the shows and episodes whose names appear anywhere in `data`. */
export function slugsMentioned(entities: readonly IndexedEntity[], data: unknown): Slugs {
  const words = stringsIn(data, new Set<string>())
  const slugs: Slugs = { shows: {}, episodes: {} }
  for (const entity of entities) {
    if (!words.has(entity.name)) continue
    if (entity.kind === 'show') slugs.shows[entity.name] = entity.slug
    else if (entity.show !== null && words.has(entity.show)) slugs.episodes[episodeKey(entity.show, entity.name)] = entity.slug
  }
  return slugs
}
