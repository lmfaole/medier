// Gives the links and pictures under it the index of what has a page and where the page stands (`entity-context.ts`).

import type { Where } from '@designsystem/watch/where'
import type { ReactNode } from 'react'

import type { EntitySummary } from '@/lib/types'
import { MusicContextValue } from './entity-context'

export function MusicProvider({ index, where, children }: { index: readonly EntitySummary[]; where: Where; children: ReactNode }) {
  return <MusicContextValue value={{ index, where }}>{children}</MusicContextValue>
}
