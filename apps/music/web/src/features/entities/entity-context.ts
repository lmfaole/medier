// What every link and picture on a music page needs to know: the index of what has a page of its own (read by the Astro
// page and passed down, so the links are in the HTML) and where the page stands, so a link opens its card over it.

import type { Where } from '@designsystem/watch/where'
import { createContext, useContext } from 'react'

import type { EntitySummary } from '@/lib/types'
import { type EntityLookup, lookupFor, NO_ENTITIES } from './entity-lookup'

export interface MusicContext {
  index: readonly EntitySummary[] | undefined
  where: Where
}

export const MusicContextValue = createContext<MusicContext>({ index: undefined, where: { path: '/', search: {} } })

export function useEntityLookup(): EntityLookup {
  const { index } = useContext(MusicContextValue)
  return index === undefined ? NO_ENTITIES : lookupFor(index)
}
