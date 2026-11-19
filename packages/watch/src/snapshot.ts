/** The requests the snapshot of a watch-log app has a file for: the overview, every
 * calendar day, every year with a viewing, and every item (a collection's too) and person. The app supplies its own viewings, and says with `library: false` that it has no library page. */

import type { SnapshotRequests } from '@designsystem/config/snapshot-files'

import { itemKey, watchCore, type WatchCollectionLine, type WatchConfig, type WatchItem, type WatchViewing } from './viewing.ts'

export function watchSnapshot<ItemKind extends string, PlaceKind extends string, Item extends WatchItem>({ config, viewingsOf, collectionOf, library = true }: { config: WatchConfig<ItemKind, PlaceKind>; library?: boolean; viewingsOf: (db: D1Database) => Promise<WatchViewing<Item>[]>; collectionOf?: (db: D1Database) => Promise<WatchCollectionLine<Item>[]> }): SnapshotRequests {
  const { entitiesOf, itemSlug, yearsOf, unseenOf } = watchCore(config)
  return {
    async requests(db) {
      const viewings = await viewingsOf(db)
      const unseen = unseenOf(viewings, collectionOf === undefined ? [] : await collectionOf(db))
      return [
        '/api/overview.json',
        '/api/history.json',
        ...yearsOf(viewings).map((year) => `/api/history.json?year=${year}`),
        ...(library ? ['/api/library.json'] : []),
        ...entitiesOf(viewings).map(({ kind, slug }) => `/api/entity.json?kind=${kind}&slug=${slug}`),
        // A work the owner has or wants and has not seen has a page too.
        ...unseen.map((line) => `/api/entity.json?kind=${config.itemKind}&slug=${itemSlug(itemKey(line))}`),
      ]
    },
  }
}
