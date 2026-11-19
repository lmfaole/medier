/** The schema of `timeline.json` as a page reads it (`readApi`): it must produce what the loader returns, and imports no SQL, so a page can take it at run time. */
import * as v from 'valibot'

import { SERVICES, type TimelineEntry } from './timeline.ts'

export const TimelineResponse = v.object({
  entries: v.array(v.object({ app: v.picklist(SERVICES), at: v.string(), hasTime: v.boolean(), title: v.string(), subtitle: v.nullable(v.string()), image: v.nullable(v.string()) })),
}) satisfies v.GenericSchema<unknown, { entries: TimelineEntry[] }>

/** The schema of each API file of a page that reads the timeline (`readApi(url, 'timeline', RESPONSES.timeline)`). */
export const RESPONSES = { timeline: TimelineResponse }
