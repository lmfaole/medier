/**
 * What a podkast page reads besides its own answer: the slugs of the names in it, so a show or an episode in a list is a link.
 * The index is read once per request, however many of these ask for it.
 */

import { readApi } from '@designsystem/config/astro-api'
import type * as v from 'valibot'

import { slugsMentioned, type IndexedEntity, type Slugs } from '@/lib/slugs'
import { RESPONSES } from './responses.ts'

export type EntityData = NonNullable<v.InferOutput<typeof RESPONSES.entity>>

const indexes = new WeakMap<Request, Promise<IndexedEntity[]>>()

/** A page still renders, with plain text for every name, where the index cannot be read. */
function indexOf(request: Request, url: URL): Promise<IndexedEntity[]> {
  const known = indexes.get(request)
  if (known !== undefined) return known
  const read = readApi(url, 'entities', RESPONSES.entities).catch((): IndexedEntity[] => [])
  indexes.set(request, read)
  return read
}

/** The slugs of the shows and episodes `data` names. */
export async function readSlugs(request: Request, url: URL, data: unknown): Promise<Slugs> {
  return slugsMentioned(await indexOf(request, url), data)
}
