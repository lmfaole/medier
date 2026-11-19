// The front page of a watch-log app: the way into its pages and the latest viewings. Astro: plain HTML, no directive.

import { formatShortDay } from '@designsystem/intl/listening'
import { titleWithYear } from '@designsystem/intl/text'
import { FrontPage } from '@designsystem/ui/components/front-page'
import { ItemLink } from '@lmfaole/designsystem/components/item-link'
import { details } from '@designsystem/ui/lib/details'
import { PageHeader } from '@designsystem/ui/components/page-header'
import { Text } from '@lmfaole/designsystem/components/text'

import { episodeLabel } from '../format.ts'
import type { WatchLinks } from '../lists.tsx'
import type { Overview } from '../viewing.ts'
import type { FrontWords } from '../words.ts'
import { TmdbNotice } from './notice.tsx'

export function OverviewPage({ words, links, data }: { words: { title: string; front: FrontWords }; links: WatchLinks; data: Overview }) {
  if (data.totals.plays === 0) {
    return (
      <>
        <PageHeader title={words.title} lead={words.front.lead} />
        <Text tone="muted">{words.front.empty}</Text>
        <div className="mt-8">
          <TmdbNotice />
        </div>
      </>
    )
  }

  return (
    <>
      <FrontPage
        app="film"
        title={words.title}
        lead={words.front.lead}
        latest={{
          title: 'Sist sett',
          rows: data.recent.map((viewing, index) => ({
            key: `${viewing.on}/${viewing.slug}/${index}`,
            cover: viewing.poster,
            title: <ItemLink as={links.item} slug={viewing.slug}>{titleWithYear(viewing.title, viewing.year)}</ItemLink>,
            subtitle: details([episodeLabel(viewing.episode), viewing.cinema]),
            when: `${formatShortDay(viewing.on)}${viewing.at === null ? '' : ` ${viewing.at}`}`,
          })),
        }}
      />
      <div className="mt-8">
        <TmdbNotice />
      </div>
    </>
  )
}
