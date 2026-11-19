// `/historikk?year=YYYY`: every viewing of one year, newest first, in the shared history page: the day, what it was,
// how it was rated and where it was seen.
// Astro: plain HTML, no directive.

import { formatShortDay } from '@designsystem/intl/listening'
import { formatRatingOfFive } from '@designsystem/intl/number'
import { pluralize } from '@designsystem/intl/plural'
import { titleWithYear } from '@designsystem/intl/text'
import { HistoryPage as SharedHistoryPage } from '@designsystem/ui/components/history-page'
import { details } from '@designsystem/ui/lib/details'

import { episodeLabel } from '../format.ts'
import { type WatchLinks } from '../lists.tsx'
import { ItemLink } from '@lmfaole/designsystem/components/item-link'
import type { History } from '../viewing.ts'

export function HistoryPage({ links, data: history }: { links: WatchLinks; data: History }) {
  return (
    <SharedHistoryPage
      app="film"
      period={{ kind: 'year', selected: history.year, periods: history.years }}
      listTitle="Alle visninger"
      summary={`${pluralize(history.plays.length, { one: '{count} visning', other: '{count} visninger' }, 'nb-NO')}.`}
      rows={history.plays.map((viewing, index) => {
        const episode = episodeLabel(viewing.episode)
        return {
          key: `${viewing.on}/${viewing.slug}/${episode}/${index}`,
          cover: viewing.cover,
          title: (
            <>
              <ItemLink as={links.item} slug={viewing.slug}>{titleWithYear(viewing.title, viewing.year)}</ItemLink>
              {viewing.rewatch ? <span className="ml-1 text-muted-foreground">(igjen)</span> : null}
            </>
          ),
          subtitle: details([viewing.creator, episode, viewing.rating === null ? null : formatRatingOfFive(viewing.rating), viewing.place]),
          when: formatShortDay(viewing.on),
        }
      })}
    />
  )
}
