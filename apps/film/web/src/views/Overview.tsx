// `/`: the way into the pages and the latest viewings. Plain HTML, no directive.

import { OverviewPage } from '@designsystem/watch/pages/overview'
import type { Overview as OverviewData } from '@designsystem/watch/viewing'

import { filmLinks } from '@/links'
import { words } from '@/words'

export function Overview({ data }: { data: OverviewData }) {
  return <OverviewPage words={words} links={filmLinks()} data={data} />
}
