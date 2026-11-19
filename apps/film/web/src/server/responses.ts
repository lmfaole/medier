/**
 * The schema of each API file a film page reads (`readApi`), next to the server's loaders: `RESPONSES` must produce what
 * `API` returns, so a loader that changes its answer fails the typecheck here until its schema follows. No SQL is
 * imported, so a page can take this at run time.
 */
import { WATCH_RESPONSES } from '@designsystem/watch/response-schemas'
import { MaybeText, Text, Count } from '@designsystem/ui/lib/schema-parts'
import * as v from 'valibot'

import type { ApiResponses } from './api.ts'

const Cinema = v.object({ name: Text, slug: Text, owner: MaybeText, city: MaybeText, country: MaybeText, image: MaybeText, visits: Count, films: Count, first: MaybeText, last: MaybeText })

export const RESPONSES = { ...WATCH_RESPONSES, cinemas: v.object({ cinemas: v.array(Cinema) }) } satisfies {
  [File in keyof ApiResponses]: v.GenericSchema<unknown, ApiResponses[File]>
}
