/** The requests the snapshot has a file for: the overview, every calendar day, every month and year with a viewing, and every film and person. */

import type { SnapshotRequests } from '@designsystem/config/snapshot-files'
import { watchSnapshot } from '@designsystem/watch/snapshot'

import { collectionOf, viewingsOf } from './api.ts'
import { FILM } from './film-stats.ts'

const base = watchSnapshot({ config: FILM, viewingsOf, collectionOf, library: false })

export const snapshot: SnapshotRequests = {
  async requests(db) {
    return [...(await base.requests(db)), '/api/cinemas.json']
  },
}
