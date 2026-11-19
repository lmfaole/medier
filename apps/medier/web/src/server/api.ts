/**
 * The API of the hub: one file, `timeline.json`, the latest of the seven media apps that keep a log, read from their
 * databases per request (`@designsystem/timeline`).
 */

import type { ApiResponsesOf, AppApi } from '@designsystem/config/api-files'
import { TIMELINE_DOMAINS, timeline } from '@designsystem/timeline/api'

/** The databases the media server opens for this API: the first is the main one, the others are attached. */
export const DOMAINS = TIMELINE_DOMAINS

export const API = { timeline } satisfies AppApi

export type ApiResponses = ApiResponsesOf<typeof API>
