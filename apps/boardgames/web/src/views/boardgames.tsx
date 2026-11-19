// The islands of the boardgames pages: the shelf views made from boardgames's own words, and a game's page with what
// BoardGameGeek adds. A page imports the view it wants and names the directive (`client:visible` for the log chart,
// `client:idle` for the library, none for plain HTML).

import { WorkView } from '@designsystem/shelf/entity'
import { shelfViews } from '@designsystem/shelf/views'

import { boardgameExtras } from '@/entity-extras'
import type { ApiResponses } from '@/server/api'
import { words } from '@/words'

type BoardgamePage = NonNullable<ApiResponses['entity']>

const views = shelfViews(words, 'boardgame')

export const Overview = views.Overview
export const History = views.History
export const Library = views.Library

/** `client:visible`: the log chart. */
export function Entity({ data }: { data: BoardgamePage }) {
  return <WorkView words={words} data={data} extras={boardgameExtras} />
}
