// One item's, one person's or one place's own page. The register's own facts of an item and a place travel with the
// answer, so all three pages are shared; `toModel` (`./entity-model.ts`) says what the page holds and `EntityView` how it looks.
// Astro: `client:visible` on the app's view (the page holds a chart).

import { ErrorMessage } from '@lmfaole/designsystem/components/error-message'
import { EntityView as View } from '@designsystem/ui/components/entity-view'
import { pageHref } from '@designsystem/ui/lib/detail-state'

import type { ItemPage, PersonPage, PlacePage } from '../viewing.ts'
import type { WatchWords } from '../words.ts'
import { toModel } from './entity-model.ts'

/** The page of one thing, from the answer of `entityRequest(slug, kind)`; `null` is a slug with no page. */
export function EntityView({ data, words }: { data: ItemPage | PersonPage | PlacePage | null; words: WatchWords }) {
  const href = {
    item: (slug: string) => pageHref({ kind: words.itemKind, slug }),
    person: (slug: string) => pageHref({ kind: 'person', slug }),
    place: (slug: string) => pageHref({ kind: words.placeKind, slug }),
  }
  return data === null ? <ErrorMessage error={new Error('Fant ingen side her.')} /> : <View model={toModel(data, words, href)} />
}
