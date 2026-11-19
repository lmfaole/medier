/**
 * The views of a shelf app's pages, made once from the app's own words (`shelfViews(words, kind)`) in its `views/shelf.tsx`.
 * They are the islands an Astro page puts on the page: their props are plain data, because `words` holds functions
 * (`amount.format`) and a function cannot cross from a `.astro` page to the browser, so the words are closed over here.
 * Each view's own file names the client directive it wants; the page's choice is repeated in `apps/<app>/AGENTS.md`.
 */

import type { AppId } from '@designsystem/ui/lib/apps'
import type { LibrarySearch } from '@designsystem/ui/lib/library-search'

import type { ShelfResponses } from './api.ts'
import { workLink } from './links.tsx'
import type { Overview, ShelfKind, WorkPage } from './shelf.ts'
import type { ShelfWords } from './words.ts'
import { WorkView } from './pages/entity.tsx'
import type { WorkExtras } from './pages/entity-model.ts'
import { HistoryPage } from './pages/history.tsx'
import { LibraryPage } from './pages/library.tsx'
import { OverviewPage } from './pages/overview.tsx'

/** What an app adds to the shared pages: the extras of a work's page. */
export interface ShelfExtras {
  work?: WorkExtras<WorkPage>
}

/** The app each kind of work belongs to. */
const APP_OF: Record<ShelfKind, AppId> = { game: 'games', book: 'books', boardgame: 'boardgames' }

export function shelfViews(words: ShelfWords, kind: ShelfKind, extras: ShelfExtras = {}) {
  return {
    /** Plain HTML: no directive. */
    Overview: ({ data }: { data: Overview }) => <OverviewPage app={APP_OF[kind]} words={words} link={workLink(kind)} data={data} />,
    /** Plain HTML: no directive. */
    History: ({ data }: { data: ShelfResponses['history'] }) => <HistoryPage app={APP_OF[kind]} words={words} link={workLink(kind)} data={data} />,
    /** `client:idle`: the filters are the one part that needs a script. */
    Library: ({ data, search }: { data: ShelfResponses['library']; search: LibrarySearch }) => (
      <LibraryPage words={words} data={data} search={search} />
    ),
    /** Plain HTML: no directive. */
    /** `client:visible`: the log chart. */
    Entity: ({ data }: { data: WorkPage }) => <WorkView words={words} data={data} extras={extras.work} />,
  }
}
