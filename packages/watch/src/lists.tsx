// The list a watch-log page shows: the items, each with its poster. An item is a link to its own page; a poster is a file the app serves.
//
// The link itself is each app's (which kinds it names a card by), built by `watchLinks`; a page passes the components in.

import { formatRatingOfFive } from '@designsystem/intl/number'
import { formatTimes } from '@designsystem/intl/listening'
import { Tiles } from '@lmfaole/designsystem/components/tiles'
import { appUrl } from '@designsystem/ui/lib/base-url'
import { Text } from '@lmfaole/designsystem/components/text'
import { type SlugLink } from '@lmfaole/designsystem/components/item-link'

import type { Listing } from './viewing.ts'

/** The three links of a page (`watchLinks`): to one item's, one person's and one place's card. */
export interface WatchLinks {
  item: SlugLink
  person: SlugLink
  place: SlugLink
}

export function ItemList({ items, emptyMessage, hrefOf }: { items: readonly Listing[]; emptyMessage: string; hrefOf: (slug: string) => string }) {
  if (items.length === 0) return <Text size="sm" tone="muted">{emptyMessage}</Text>
  return (
    <Tiles
      tiles={items.map((item) => ({
        key: item.key,
        href: item.slug === null || item.slug === undefined ? null : hrefOf(item.slug),
        title: item.year === null || item.year === undefined ? item.title : `${item.title} (${item.year})`,
        picture: item.cover === null || item.cover === undefined || item.cover === '' ? null : appUrl(item.cover),
        ratio: 'poster' as const,
        lines: [item.rating === null ? formatTimes(item.plays) : formatRatingOfFive(item.rating), item.rating !== null && item.plays > 1 ? formatTimes(item.plays) : null].filter((part) => part !== null),
      }))}
    />
  )
}
