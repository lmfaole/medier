// The island of a `/bibliotek` whose works link to their own pages, square covers: `client:idle`.
// The address's own query comes in as text and is parsed here, because Astro cannot carry `undefined` across to the browser
// and both sides must read the same search.

import * as v from 'valibot'

import { pageHref } from '../lib/detail-state'
import type { LibraryWork } from '../lib/library'
import { LibrarySearch } from '../lib/library-search'
import { LibraryPage, type LibraryWords } from './library-page'

/** The `Library` island of an app, with its words applied once. */
export function detailLibrary<Kind extends string>(words: LibraryWords<Kind>) {
  return function Library({ data, query }: { data: { works: LibraryWork<Kind>[] }; query: string }) {
    const search = v.parse(LibrarySearch, Object.fromEntries(new URLSearchParams(query)))
    return (
      <LibraryPage
        data={data}
        search={search}
        words={words}
        hrefOf={(work) => pageHref({ kind: work.kind, slug: work.slug })}
        ratio={() => 'square'}
      />
    )
  }
}
