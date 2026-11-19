/** The requests the snapshot has a file for: the timeline. */

import type { SnapshotRequests } from '@designsystem/config/snapshot-files'

export const snapshot: SnapshotRequests = {
  requests: async () => ['/api/timeline.json'],
}
