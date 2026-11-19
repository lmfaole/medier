// Podkast's links: a show and an episode each have a page, `/show/<slug>` and `/episode/<slug>`.
// A name the index has no page for is plain text.

import type { ReactNode } from 'react'
import { CardLink } from '@lmfaole/designsystem/components/card-link'
import { pageHref } from '@designsystem/ui/lib/detail-state'

import { episodeKey, type Slugs } from '@/lib/slugs'

export interface PodkastLinks {
  /** `name` as a link to the show's page, or as text; `children` replaces the text where a tile or a picture is the link, with `look="block"`. */
  show: (name: string, look?: 'block', children?: ReactNode) => ReactNode
  episode: (show: string, name: string, look?: 'block') => ReactNode
}

export function podkastLinks(slugs: Slugs): PodkastLinks {
  const card = (kind: 'show' | 'episode', slug: string, children: ReactNode, look?: 'block') => (
    <CardLink href={pageHref({ kind, slug })} {...(look === undefined ? {} : { look })}>
      {children}
    </CardLink>
  )
  return {
    show(name, look, children = name) {
      const slug = slugs.shows[name]
      return slug === undefined ? <span>{children}</span> : card('show', slug, children, look)
    },
    episode(show, name, look) {
      const slug = slugs.episodes[episodeKey(show, name)]
      return slug === undefined ? <span>{name}</span> : card('episode', slug, name, look)
    },
  }
}
