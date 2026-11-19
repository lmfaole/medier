// The names that have a page of their own. A name that has one is a link to that page; one that has none is plain text. The index of what has a page comes with the page (`entity-context.tsx`).

import type { ReactNode } from 'react'
import { pageHref } from '@designsystem/ui/lib/detail-state'
import { CardLink } from '@lmfaole/designsystem/components/card-link'
import { Text } from '@lmfaole/designsystem/components/text'
import type { EntityKind } from '@/lib/types'
import { useEntityLookup } from './entity-context'

/** How a link looks beyond the shared name look: `strong` is the name of a row, `block` fills its line for a link that holds a picture and a text. */
type Look = 'strong' | 'block'

interface EntityLinkProps {
  kind: EntityKind
  name: string
  /** The artist of an album or a song. */
  artist?: string
  look?: Look
  /** What the link shows; the name by default. */
  children?: ReactNode
}

/** What a name shows when it has no page: the same weight, no link. */
function Unlinked({ look, children }: { look: Look | undefined; children: ReactNode }) {
  return look === 'strong' ? <Text as="span" weight="medium">{children}</Text> : <>{children}</>
}

/** The name as a link to its page, or as text when it has none. */
export function EntityLink({ kind, name, artist, look, children = name }: EntityLinkProps) {
  const entity = useEntityLookup()(kind, name, artist)
  if (entity === undefined) return <Unlinked look={look}>{children}</Unlinked>
  const href = pageHref({ kind, slug: entity.slug })
  return look === undefined ? <CardLink href={href}>{children}</CardLink> : <CardLink href={href} look={look}>{children}</CardLink>
}

export function ArtistLink({ name }: { name: string }) {
  return <EntityLink kind="artist" name={name} />
}

export function AlbumLink({ album, artist }: { album: string; artist: string }) {
  return <EntityLink kind="album" name={album} artist={artist} />
}

export function SongLink({ track, artist, look }: { track: string; artist: string; look?: Look }) {
  return <EntityLink kind="song" name={track} artist={artist} {...(look === undefined ? {} : { look })} />
}
