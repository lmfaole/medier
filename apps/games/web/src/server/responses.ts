/**
 * The schema of each API file a page reads (`readPage`): the shelf apps' own (`@designsystem/shelf/responses`), checked here
 * against what this app's loaders return, so a loader that changes its answer fails the typecheck until its schema follows.
 */
import { SHELF_RESPONSES } from '@designsystem/shelf/responses'
import type * as v from 'valibot'

import type { ApiResponses } from './api.ts'

export const RESPONSES = SHELF_RESPONSES satisfies {
  [File in keyof ApiResponses]: v.GenericSchema<unknown, ApiResponses[File]>
}
