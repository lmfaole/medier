/** What the books app says: the words of its pages, for the shared shelf pages (`@designsystem/shelf`). */

import { formatCount } from '@designsystem/intl/listening'
import { formatAmount } from '@designsystem/ui/lib/entity-model'
import { appNavLabel } from '@designsystem/ui/lib/apps'
import type { ShelfWords } from '@designsystem/shelf/words'

export const words: ShelfWords = {
  kind: 'book',
  title: 'Bøker',
  noun: { one: 'bok', many: 'bøker' },
  lead: 'Det jeg har lest, fra loggen min, Hardcover og Open Library.',
  empty: 'Ingen bøker i loggen ennå.',
  pagesLabel: appNavLabel('books'),
  libraryLabels: { doing: 'Leser', done: 'Lest', want: 'Vil lese', dropped: 'Lagt vekk' },
  statusLabels: { done: 'Lest', reading: 'Leser', dropped: 'Lagt vekk', want: 'Vil lese', owned: 'Eier' },
  creatorLabel: 'Forfatter',
  amount: { label: 'Sider lest', unit: 'pages', format: (pages) => formatAmount('pages', pages) },
  doneDetail: (count) => `${formatCount(count)} lest`,
  credit: { name: 'Open Library', href: 'https://openlibrary.org' },
  coverRatio: 'poster',
  itemTitle: 'Bok',
}
