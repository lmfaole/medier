// The library page's search, kept in the address so a filtered list survives a reload and can be linked to: `?q=` is a
// word to look for, and `?status=`, `?kind=` and `?format=` narrow it. Nothing else gets through.

import { normalizeTitle } from "@designsystem/intl/text"
import * as v from "valibot"

import { LIBRARY_STATUSES } from "./library.ts"

const optionalText = v.fallback(v.optional(v.pipe(v.string(), v.trim(), v.maxLength(100), v.nonEmpty())), undefined)

export const LibrarySearch = v.object({
  q: optionalText,
  status: v.fallback(v.optional(v.picklist(LIBRARY_STATUSES)), undefined),
  kind: optionalText,
  format: optionalText,
})

export type LibrarySearch = v.InferOutput<typeof LibrarySearch>

/** Whether `text` has every word of `query`, ignoring case, accents and punctuation. An empty query matches everything. */
export function matchesQuery(text: string, query: string | undefined): boolean {
  if (query === undefined) return true
  const haystack = normalizeTitle(text)
  return query.split(/\s+/).every((word) => haystack.includes(normalizeTitle(word)))
}

/** The address's query string for a search (with its leading `?`, or nothing), so the page can show the search it filters by without a reload. */
export function librarySearchQuery(search: LibrarySearch): string {
  const query = new URLSearchParams(Object.entries(search).filter((entry): entry is [string, string] => entry[1] !== undefined)).toString()
  return query === "" ? "" : `?${query}`
}
