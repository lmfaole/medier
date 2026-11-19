// `/tilbakeblikk`: the head of the pages that look back (week by week, month by month, year by year); the way into them is the app's menu. Plain HTML, no directive.

import { PageHeader } from '@designsystem/ui/components/page-header'

export function Retrospective() {
  return <PageHeader page="music:/tilbakeblikk" />
}
