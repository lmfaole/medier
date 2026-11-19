/** What the games app says: the words of its pages, for the shared shelf pages (`@designsystem/shelf`). */

import { formatCount } from '@designsystem/intl/listening'
import { formatAmount } from '@designsystem/ui/lib/entity-model'
import { appNavLabel } from '@designsystem/ui/lib/apps'
import type { ShelfWords } from '@designsystem/shelf/words'

/** One line of the log: `45 min`, `2 t`, `3 t 10 min`. */
export function hoursAndMinutes(hours: number): string {
  const minutes = Math.max(1, Math.round(hours * 60))
  const [whole, rest] = [Math.floor(minutes / 60), minutes % 60]
  return [whole > 0 ? `${formatCount(whole)} t` : '', rest > 0 ? `${rest} min` : ''].filter(Boolean).join(' ')
}

export const words: ShelfWords = {
  kind: 'game',
  title: 'Spill',
  noun: { one: 'spill', many: 'spill' },
  lead: 'Det jeg har spilt, fra loggen min, Steam og spillregisteret IGDB.',
  empty: 'Ingen spill i loggen ennå.',
  pagesLabel: appNavLabel('games'),
  libraryLabels: { doing: 'Spiller', done: 'Spilt ut', owned: 'Eier', dropped: 'Gitt opp' },
  statusLabels: { done: 'Spilt ut', playing: 'Spiller', dropped: 'Gitt opp', owned: 'Eier', want: 'Ønsker' },
  creatorLabel: 'Utvikler',
  amount: { label: 'Timer spilt', unit: 'hours', format: (hours) => formatAmount('hours', hours), formatLine: hoursAndMinutes },
  doneDetail: (count) => `${formatCount(count)} spilt ut`,
  credit: { name: 'IGDB', href: 'https://www.igdb.com' },
  coverRatio: 'poster',
  itemTitle: 'Spill',
}
