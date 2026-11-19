// A film's, a person's or a cinema's own page. `client:visible`: the page holds a chart.

import { EntityView } from '@designsystem/watch/pages/entity'
import type { ItemPage, PersonPage, PlacePage } from '@designsystem/watch/viewing'

import { words } from '@/words'

export function Entity({ data }: { data: ItemPage | PersonPage | PlacePage }) {
  return <EntityView data={data} words={words} />
}
