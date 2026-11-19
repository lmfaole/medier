/**
 * The API of the public work page: one file, `cv.json`, built from the local databases by a loader that
 * names its columns (`cv.ts`). Everything here is published to anyone.
 */

import type { ApiResponsesOf, AppApi } from '@designsystem/config/api-files'

import { cv } from './cv.ts'

/** The databases the snapshot opens for this API (`scripts/snapshot-app.ts`): the first is its own. */
export const DOMAINS = ['cv', 'github'] as const

export const API = {
  cv: (db: D1Database) => cv(db),
} satisfies AppApi

export type ApiResponses = ApiResponsesOf<typeof API>
