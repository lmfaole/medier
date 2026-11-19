/** The requests the snapshot has a file for: the overview, every calendar day, every month and year with a viewing, and every series and person. */

import type { SnapshotRequests } from '@designsystem/config/snapshot-files'
import { watchSnapshot } from '@designsystem/watch/snapshot'

import { collectionOf, viewingsOf } from './api.ts'
import { TV } from './tv-stats.ts'

export const snapshot: SnapshotRequests = watchSnapshot({ config: TV, viewingsOf, collectionOf, library: false })
