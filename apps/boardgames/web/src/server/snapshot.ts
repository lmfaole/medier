/** The requests the snapshot has a file for: the shared ones. */

import type { SnapshotRequests } from '@designsystem/config/snapshot-files'

import { shelf } from './api.ts'

export const snapshot: SnapshotRequests = shelf.snapshot
