// The API files a watch-log app's Worker serves and what each holds, for the app's own `ApiResponses` to be checked against.

import type { LibraryWork } from '@designsystem/ui/lib/library'
import type { History, ItemPage, Overview, PersonPage, PlacePage } from './viewing.ts'

export interface WatchResponses extends Record<string, unknown> {
  overview: Overview
  history: History
  library: { works: LibraryWork[] }
  entity: ItemPage | PersonPage | PlacePage | null
}
