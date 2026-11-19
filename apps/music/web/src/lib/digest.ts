// The notification at the end of a week or a month: what was heard and how it differs from the one before.

import { formatCount } from '@designsystem/intl/listening'
import { formatTime } from '@designsystem/intl/time'

import { changeSaid } from './spans.ts'
import type { SpanSummary } from './types.ts'

/** What a person can ask to be told about: the end of each week, and the end of each month. */
export const TOPICS = ['week', 'month'] as const
export type Topic = (typeof TOPICS)[number]

export interface Digest {
  title: string
  body: string
  /** Where the notification leads, under the app's base: the page that shows the same numbers. */
  path: string
}

const PAGE = { week: '/tilbakeblikk/uke', month: '/tilbakeblikk/maaned' } as const

/**
 * The notification for `spans` (newest first, the one that is ending first, from `weeks()` or `months()`), or `null` when nothing was heard in it.
 * The one that is ending is compared with the one before as if it were over, which the pages do not do for the one still going.
 */
export function digestOf(topic: Topic, spans: readonly SpanSummary[]): Digest | null {
  const [now, before] = spans
  if (now === undefined || now.plays === 0) return null
  const change = before === undefined || before.plays === 0 ? null : Math.round(((now.plays - before.plays) / before.plays) * 100)
  const said = changeSaid(change, topic === 'week' ? 'uken før' : 'måneden før')
  const artists = now.topArtists.map((top) => `${top.artist} (${formatCount(top.plays)})`)
  const name = topic === 'week' ? `Uke fra ${formatTime(now.start, 'day')}` : formatTime(now.start, 'month').replace(/^./, (first) => first.toUpperCase())
  return {
    title: `${name}: ${formatCount(now.plays)} avspillinger`,
    body: [said === '' ? null : `${said.charAt(0).toUpperCase()}${said.slice(1)}.`, artists.length === 0 ? null : `Mest ${artists.join(', ')}.`].filter((part) => part !== null).join(' '),
    path: PAGE[topic],
  }
}
