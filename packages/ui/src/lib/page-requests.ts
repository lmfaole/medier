/**
 * What each standard page of the log apps asks the snapshot for, given its parsed address. An Astro page reads
 * `?query=` with one of the schemas (`period-search.ts`), maps it here, and hands the result to
 * `readPage` (`@designsystem/config/astro-api`):
 *
 *   const search = v.parse(MonthSearch, Object.fromEntries(Astro.url.searchParams))
 *   const data = await readPage(Astro.url, historyRequest(search), RESPONSES.history)
 *
 * Pure, so what a page asks for is tested without a Worker. Parameters left out are not sent, so one answer is one file.
 */

import type { MonthSearch, YearSearch } from "./period-search.ts"

/** One API file and its parameters, as `/api/<file>.json?<params>`. */
export interface PageRequest {
  file: string
  params: Record<string, string>
}

/** The front page and the statistics page: both read the overview. */
export const overviewRequest = (): PageRequest => ({ file: "overview", params: {} })

/** `/bibliotek`: every work, which the page narrows itself from `LibrarySearch`. */
export const libraryRequest = (): PageRequest => ({ file: "library", params: {} })

/** `/historikk`: one month of the history; the newest without one. */
export const historyRequest = (search: MonthSearch): PageRequest => ({ file: "history", params: definedOnly({ month: search.month }) })

/** `/historikk` of an app that goes a year at a time: one year of the history; the newest without one. */
export const yearHistoryRequest = (search: YearSearch): PageRequest => ({ file: "history", params: definedOnly({ year: search.year }) })

/** The own page of one thing, by slug and (for the apps with several kinds of page) its `kind`. */
export const entityRequest = (slug: string, kind?: string): PageRequest => ({ file: "entity", params: definedOnly({ kind, slug }) })

function definedOnly(params: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined))
}
