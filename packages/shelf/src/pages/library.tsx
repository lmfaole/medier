// `/bibliotek`: every work of the log, in the library page every app has.

import { LibraryPage as SharedLibraryPage } from '@designsystem/ui/components/library-page'
import type { LibrarySearch } from '@designsystem/ui/lib/library-search'
import type { LibraryWork } from '@designsystem/ui/lib/library'
import { pageHref } from '@designsystem/ui/lib/detail-state'

import type { ShelfWords } from '../words.ts'
import { Credit } from './credit.tsx'

// Astro: the one island of the page, `client:idle`, from an app view that holds `words` and `link`.
export function LibraryPage({ words, data, search }: { words: ShelfWords; data: { works: LibraryWork[] }; search: LibrarySearch }) {
  return (
    <SharedLibraryPage
      data={data}
      search={search}
      words={{ noun: words.noun, statusLabels: words.libraryLabels }}
      hrefOf={(work) => pageHref({ kind: words.kind, slug: work.slug })}
      ratio={() => words.coverRatio}
    >
      <Credit credit={words.credit} />
    </SharedLibraryPage>
  )
}
