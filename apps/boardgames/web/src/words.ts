/** What the boardgames app says: the words of its pages, for the shared shelf pages (`@designsystem/shelf`). */

import { formatCount } from '@designsystem/intl/listening'
import { formatAmount } from '@designsystem/ui/lib/entity-model'
import { appNavLabel } from '@designsystem/ui/lib/apps'
import type { ShelfWords } from '@designsystem/shelf/words'

export const words: ShelfWords = {
  kind: 'boardgame',
  title: 'Brettspill',
  noun: { one: 'brettspill', many: 'brettspill' },
  lead: 'Det jeg har spilt, fra loggen min og BoardGameGeek.',
  empty: 'Ingen brettspill i loggen ennå.',
  pagesLabel: appNavLabel('boardgames'),
  libraryLabels: { done: 'Spilt', owned: 'Eier', want: 'Ønsker' },
  statusLabels: { played: 'Spilt', owned: 'Eier', want: 'Ønsker' },
  creatorLabel: 'Designer',
  amount: { label: 'Partier', unit: 'plays', format: (plays) => formatAmount('plays', plays) },
  doneDetail: (count) => `${formatCount(count)} spilt`,
  credit: { name: 'BoardGameGeek', href: 'https://boardgamegeek.com' },
  coverRatio: 'square',
  itemTitle: 'Brettspill',
}
