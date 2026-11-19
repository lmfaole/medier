/**
 * The API of the media front page: one file, `timeline.json`, built from the local databases of the seven media apps
 * (`@designsystem/timeline`). Everything here is published to anyone, and it is only what those apps already show of their latest.
 */

import type { ApiResponsesOf, AppApi } from '@designsystem/config/api-files'
import { TIMELINE_DOMAINS, timeline } from '@designsystem/timeline/api'

/** The databases the snapshot opens for this API (`scripts/snapshot-app.ts`). */
export const DOMAINS = TIMELINE_DOMAINS

export const API = { timeline } satisfies AppApi

export type ApiResponses = ApiResponsesOf<typeof API>
