// The front page of a shelf app: the way into its pages and the latest of the log. Astro: plain HTML, no directive.

import type { AppId } from '@designsystem/ui/lib/apps'
import { FrontPage } from '@designsystem/ui/components/front-page'
import { PageHeader } from '@designsystem/ui/components/page-header'
import { formatShortDay } from '@designsystem/intl/listening'
import { formatRatingOfFive } from '@designsystem/intl/number'
import { titleWithYear } from '@designsystem/intl/text'
import { ItemLink } from '@lmfaole/designsystem/components/item-link'
import { details } from '@designsystem/ui/lib/details'
import { Text } from '@lmfaole/designsystem/components/text'
import type { SlugLink } from '@lmfaole/designsystem/components/item-link'

import type { Overview } from '../shelf.ts'
import type { ShelfWords } from '../words.ts'
import { Credit } from './credit.tsx'

export function OverviewPage({ app, words, link, data }: { app: AppId; words: ShelfWords; link: SlugLink; data: Overview }) {
  if (data.totals.works === 0) {
    return (
      <>
        <PageHeader title={words.title} lead={words.lead} />
        <Text tone="muted">{words.empty}</Text>
        <div className="mt-8">
          <Credit credit={words.credit} />
        </div>
      </>
    )
  }

  return (
    <>
      <FrontPage
        app={app}
        title={words.title}
        lead={words.lead}
        latest={{
          title: 'Sist',
          rows: data.recent.map((work) => ({
            key: work.slug,
            cover: work.cover,
            title: <ItemLink as={link} slug={work.slug}>{titleWithYear(work.title, work.year)}</ItemLink>,
            subtitle: details([
              work.creator,
              words.statusLabels[work.status] ?? work.status,
              work.rating === null ? null : formatRatingOfFive(work.rating),
              work.amount === null || words.amount === null ? null : words.amount.format(work.amount),
            ]),
            when: work.on === null ? '—' : formatShortDay(work.on),
          })),
        }}
      />
      <div className="mt-8">
        <Credit credit={words.credit} />
      </div>
    </>
  )
}
