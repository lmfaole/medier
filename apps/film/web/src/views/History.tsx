// `/historikk`: every viewing of one month. Plain HTML, no directive.

import { HistoryPage } from '@designsystem/watch/pages/history'
import type { History as HistoryData } from '@designsystem/watch/viewing'

import { filmLinks } from '@/links'

export function History({ data }: { data: HistoryData }) {
  return <HistoryPage links={filmLinks()} data={data} />
}
