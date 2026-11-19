// One work's own page. Astro: `client:visible` on the app's view (the page holds a chart).

import { ErrorMessage } from '@lmfaole/designsystem/components/error-message'
import { EntityView } from '@designsystem/ui/components/entity-view'

import type { WorkPage } from '../shelf.ts'
import type { ShelfWords } from '../words.ts'
import { toModel, type WorkExtras } from './entity-model.ts'

/** `data` is the answer of `entityRequest(slug)`; `null` is a slug with no page. */
export function WorkView<Page extends WorkPage = WorkPage>({ words, data, extras }: { words: ShelfWords; data: Page | null; extras?: WorkExtras<Page> }) {
  return data === null ? <ErrorMessage error={new Error('Fant ingen side her.')} /> : <EntityView model={toModel(data, words, extras)} />
}
