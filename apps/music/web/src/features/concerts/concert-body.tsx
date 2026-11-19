// One concert's page (`/konsert/<slug>`): the concert as data (`toModel`) drawn by `EntityView`. A concert named for no artist of the library is only the text.

import { EntityView } from '@designsystem/ui/components/entity-view'

import { useLinkContext } from '@/features/entities/entity-body'
import type { ArtistPage, ConcertSummary } from '@/lib/types'
import { toModel } from './concert-model'

export function ConcertBody({ concert, artist }: { concert: ConcertSummary; artist: ArtistPage | null }) {
  const ctx = useLinkContext()
  return <EntityView model={toModel(concert, artist, (name) => ctx.href('artist', name))} />
}
