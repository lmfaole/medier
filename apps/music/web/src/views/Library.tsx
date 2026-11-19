// `/bibliotek`: every artist, album and song there is a page for, in the library page every app has.

import { detailLibrary } from '@designsystem/ui/components/detail-library'

import type { EntityKind } from '@/lib/types'

export const Library = detailLibrary<EntityKind>({ noun: { one: 'artist, album eller låt', many: 'artister, album og låter' }, kindLabels: { artist: 'Artister', album: 'Album', song: 'Låter' } })
