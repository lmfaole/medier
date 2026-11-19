// An artist's, an album's, a song's or a collection page, whichever the answer is: the page as data (`toModel`) drawn by `EntityView`. The links and pictures come from the index of what has a page.

import { EntityView } from '@designsystem/ui/components/entity-view'
import { pageHref } from '@designsystem/ui/lib/detail-state'
import { useMemo } from 'react'

import { CONCERT_KIND } from '@/features/concerts/concert-links'
import type { ConcertSummary, EntityPage } from '@/lib/types'
import { useEntityLookup } from './entity-context'
import { type LinkContext, toModel } from './entity-model'

/** The links and pictures of the index, as the plain functions a model takes. */
export function useLinkContext(): LinkContext {
  const lookup = useEntityLookup()
  return useMemo(
    () => ({
      href: (kind, name, artist) => {
        const entity = lookup(kind, name, artist)
        return entity === undefined ? undefined : pageHref({ kind, slug: entity.slug })
      },
      cover: (kind, name, artist) => lookup(kind, name, artist)?.cover ?? null,
      concertHref: (slug) => pageHref({ kind: CONCERT_KIND, slug }),
    }),
    [lookup],
  )
}

export function EntityBody({ page, concerts }: { page: EntityPage; concerts?: ConcertSummary[] }) {
  const ctx = useLinkContext()
  return <EntityView model={toModel(page, ctx, concerts)} />
}
