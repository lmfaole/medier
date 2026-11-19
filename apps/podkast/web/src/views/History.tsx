// `/historikk?month=YYYY-MM`: every play of one month, newest first, of every source (Spotify's export, the scrobbles and
// what the player recorded through gpodder). «Sist spilt» on the front page is the top of it. Plain HTML, no directive.

import { formatClock, formatHoursAndMinutes } from '@designsystem/intl/listening'
import { pluralize } from '@designsystem/intl/plural'
import { HistoryPage } from '@designsystem/ui/components/history-page'
import { details } from '@designsystem/ui/lib/details'
import type * as v from 'valibot'

import type { Slugs } from '@/lib/slugs'
import { podkastLinks } from '@/links'
import type { RESPONSES } from '@/server/responses'

export function History({ data, slugs }: { data: v.InferOutput<typeof RESPONSES.history>; slugs: Slugs }) {
  const links = podkastLinks(slugs)
  const minutes = Math.round(data.plays.reduce((sum, play) => sum + play.ms, 0) / 60_000)
  return (
    <HistoryPage
      app="podkast"
      period={{ kind: 'month', selected: data.month, periods: data.months }}
      listTitle="Alle avspillinger"
      summary={`${pluralize(data.plays.length, { one: '{count} avspilling', other: '{count} avspillinger' }, 'nb-NO')}${minutes > 0 ? `, ${formatHoursAndMinutes(minutes)}` : ''}.`}
      rows={data.plays.map((play, index) => ({
        key: `${play.at}/${play.episode}/${index}`,
        cover: play.cover,
        title: links.episode(play.show, play.episode),
        subtitle: details([links.show(play.show), play.ms > 0 ? formatHoursAndMinutes(Math.round(play.ms / 60_000)) : null]),
        when: formatClock(play.at),
      }))}
    />
  )
}
