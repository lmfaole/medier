/**
 * The API of the games pages: files built from the local games database (`games.db`) by loaders that read the
 * log and the works the register matched to it (`shelfLinesSql`), counted in `@designsystem/shelf`. Everything here is
 * published to anyone: the log's notes and the services' own numbers are not read at all.
 */

import type { ApiResponsesOf } from '@designsystem/config/api-files'
import { shelfApi } from '@designsystem/shelf/api'
import type { ShelfConfig } from '@designsystem/shelf/shelf'

/** The databases the snapshot opens for this API (`scripts/snapshot-app.ts`): the first is its own. */
export const DOMAINS = ['games'] as const

/** The statuses `games-sync` accepts in the log (`TOOL` in its `main.rs`), the furthest along first; `owned` and `want` are the collection's, so a work with no line in the log has one of them. */
export const GAMES: ShelfConfig = { kind: 'game', statuses: ['done', 'playing', 'dropped'], done: ['done'], library: { done: 'done', playing: 'doing', dropped: 'dropped', owned: 'owned', want: 'want' } }

export const shelf = shelfApi(GAMES, 'game')

export const API = shelf.API

export type ApiResponses = ApiResponsesOf<typeof API>
