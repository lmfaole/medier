/**
 * The schema of each API file a page reads (`readPage`): the shelf apps' own (`@designsystem/shelf/responses`) with the two
 * files board games add to them, a game's `details` on its page and the register's figures in `details.json`. Each is
 * checked here against what this app's loaders return, so a loader that changes its answer fails the typecheck until its
 * schema follows.
 */
import { SHELF_RESPONSES } from '@designsystem/shelf/responses'
import * as v from 'valibot'

import type { ApiResponses } from './api.ts'

const Nullable = {
  string: v.nullable(v.string()),
  number: v.nullable(v.number()),
}

const Tie = v.object({ name: v.string(), url: v.string() })

const BoardgameDetailsSchema = v.object({
  thumbnail: Nullable.string,
  players: v.object({ min: Nullable.number, max: Nullable.number, best: Nullable.string, recommended: Nullable.string }),
  playingTime: v.object({ typical: Nullable.number, min: Nullable.number, max: Nullable.number }),
  minAge: Nullable.number,
  rating: v.nullable(v.object({ average: v.number(), bayes: Nullable.number, deviation: Nullable.number, count: Nullable.number })),
  weight: v.nullable(v.object({ value: v.number(), count: Nullable.number })),
  ranks: v.array(v.object({ label: v.string(), position: v.number() })),
  community: v.object({ owned: Nullable.number, trading: Nullable.number, wanting: Nullable.number, wishing: Nullable.number, comments: Nullable.number }),
  votes: v.array(v.object({ players: v.string(), best: v.number(), recommended: v.number(), notRecommended: v.number() })),
  designers: v.array(Tie),
  artists: v.array(Tie),
  publishers: v.array(Tie),
  mechanics: v.array(Tie),
  families: v.array(Tie),
  expansions: v.array(Tie),
  implementations: v.array(Tie),
  integrations: v.array(Tie),
  compilations: v.array(Tie),
  contains: v.array(Tie),
  otherNames: v.array(v.string()),
})

// `wrapped` is the shared work page; the intersection adds the register's side to it without a second copy of its fields.
const EntitySchema = v.nullable(v.intersect([SHELF_RESPONSES.entity.wrapped, v.object({ details: v.nullable(BoardgameDetailsSchema) })]))

export const RESPONSES = { ...SHELF_RESPONSES, entity: EntitySchema } satisfies {
  [File in keyof ApiResponses]: v.GenericSchema<unknown, ApiResponses[File]>
}
