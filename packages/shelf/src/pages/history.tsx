// `/historikk?year=YYYY`: the lines of the log in one year, newest first, in the shared history page.

import { formatShortDay } from '@designsystem/intl/listening'
import { formatRatingOfFive } from '@designsystem/intl/number'
import { pluralize } from '@designsystem/intl/plural'
import { titleWithYear } from '@designsystem/intl/text'
import type { AppId } from '@designsystem/ui/lib/apps'
import { HistoryPage as SharedHistoryPage } from '@designsystem/ui/components/history-page'
import { details } from '@designsystem/ui/lib/details'
import { ItemLink, type SlugLink } from '@lmfaole/designsystem/components/item-link'

import type { HistoryEntry } from '../shelf.ts'
import type { ShelfWords } from '../words.ts'

interface ShelfHistory {
  year: string
  years: string[]
  entries: HistoryEntry[]
}

// Astro: plain HTML, no directive.
export function HistoryPage({ app, words, link, data: history }: { app: AppId; words: ShelfWords; link: SlugLink; data: ShelfHistory }) {
  return (
    <SharedHistoryPage
      app={app}
      period={{ kind: 'year', selected: history.year, periods: history.years }}
      listTitle={`Alle ${words.noun.many}`}
      summary={`${pluralize(history.entries.length, { one: '{count} linje', other: '{count} linjer' }, 'nb-NO')} i loggen.`}
      rows={history.entries.map((entry, index) => ({
        key: `${entry.on}/${entry.slug}/${index}`,
        cover: entry.cover,
        title: <ItemLink as={link} slug={entry.slug}>{titleWithYear(entry.title, entry.year)}</ItemLink>,
        subtitle: details([
          entry.creator,
          words.statusLabels[entry.status] ?? entry.status,
          entry.rating === null ? null : formatRatingOfFive(entry.rating),
          words.amount === null || entry.amount === null ? null : (words.amount.formatLine ?? words.amount.format)(entry.amount),
        ]),
        when: entry.on === null ? '—' : formatShortDay(entry.on),
      }))}
    />
  )
}
