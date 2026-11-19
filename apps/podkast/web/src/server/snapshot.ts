/** The requests the snapshot has a file for: the overview, every calendar day, every show and episode, and every month the plays have. */

import type { SnapshotRequests } from '@designsystem/config/snapshot-files'


import { playsOf } from './api.ts'
import { entitiesOf, monthsOf } from './podcast-stats.ts'

export const snapshot: SnapshotRequests = {
  async requests(db) {
    const plays = await playsOf(db)
    return [
      '/api/overview.json',
      '/api/entities.json',
      '/api/covers.json',
      ...entitiesOf(plays).map(({ kind, slug }) => `/api/entity.json?kind=${kind}&slug=${slug}`),
      // Every play of a month: the whole history is thousands of rows.
      '/api/history.json',
      ...monthsOf(plays).map((month) => `/api/history.json?month=${month}`),
    ]
  },
}
