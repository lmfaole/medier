/**
 * What one shelf app says: its name, its nouns and the sentences only its own kind of work needs. The pages themselves
 * (`./pages/*`) are written once and read by all three, so a sentence they share is a literal there and only what
 * differs is here.
 */

import type { AmountUnit } from '@designsystem/ui/lib/entity-model'
import type { LibraryStatus } from '@designsystem/ui/lib/library'

export interface ShelfWords {
  /** Which kind of work the app's pages are about. */
  kind: 'game' | 'book' | 'boardgame'
  title: string
  /** «spill», «bok»; the plural is for «3 bøker». */
  noun: { one: string; many: string }
  lead: string
  /** The page where the log has nothing yet. */
  empty: string
  pagesLabel: string
  /** What the log's own words mean to a reader: «Spilt», «Lest». */
  statusLabels: Readonly<Record<string, string>>
  /** The same words for the statuses of the library every app has, where this app has better than the default. */
  libraryLabels: Partial<Record<LibraryStatus, string>>
  /** The word for the one that made it: «Utvikler», «Forfatter», «Designer». */
  creatorLabel: string
  /** «Timer spilt», «Sider lest», «Partier»; none for an app that counts no amount. `format` is for totals, `formatLine` (else `format`) for one line of the log. */
  amount: { label: string; unit: AmountUnit; format: (amount: number) => string; formatLine?: (amount: number) => string } | null
  /** What a work being done is called in «3 ferdige»: «spilt ut», «lest», «spilt». */
  doneDetail: (count: number) => string
  /** The register the facts and covers come from, which its terms ask the pages to credit. */
  credit: { name: string; href: string }
  /** The shape of the app's covers: a game or a book is a poster, a board game's box is nearly square. */
  coverRatio: 'poster' | 'square'
  /** The label of the one work's own page. */
  itemTitle: string
}
