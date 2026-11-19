/**
 * The schema of each API file a TV page reads (`readApi`), next to the server's loaders: `RESPONSES` must produce what
 * `API` returns, so a loader that changes its answer fails the typecheck here until its schema follows. No SQL is
 * imported, so a page can take this at run time.
 */
import { WATCH_RESPONSES } from '@designsystem/watch/response-schemas'
import type * as v from 'valibot'

import type { ApiResponses } from './api.ts'

export const RESPONSES = WATCH_RESPONSES satisfies {
  [File in keyof ApiResponses]: v.GenericSchema<unknown, ApiResponses[File]>
}
