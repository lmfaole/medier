/**
 * The API of the boardgames pages: files built from the local boardgames database (`boardgames.db`) by loaders that read the
 * log and the works the register matched to it (`shelfLinesSql`), counted in `@designsystem/shelf`. Everything here is
 * published to anyone: the log's notes and the services' own numbers are not read at all.
 */

import type { ApiResponsesOf } from '@designsystem/config/api-files'
import { shelfApi } from '@designsystem/shelf/api'
import { pageOf, type ShelfConfig } from '@designsystem/shelf/shelf'

import { detailsFrom } from './details.ts'

/** The databases the snapshot opens for this API (`scripts/snapshot-app.ts`): the first is its own. */
export const DOMAINS = ['boardgames'] as const

/** The statuses `boardgames-sync` accepts in the log (`TOOL` in its `main.rs`), the furthest along first; `owned` and `want` are the collection's, so a work with no line in the log has one of them. */
export const BOARDGAMES: ShelfConfig = { kind: 'boardgame', statuses: ['played'], done: ['played'], library: { played: 'done', owned: 'owned', want: 'want' } }

export const shelf = shelfApi(BOARDGAMES, 'boardgame')

/** A game's page: the shared one, and what the register says beyond it where a game of the register's has it. */
async function entity(db: D1Database, url: URL) {
  const slug = url.searchParams.get('slug') ?? ''
  const works = await shelf.worksFrom(db)
  const page = pageOf(works, BOARDGAMES, slug)
  if (page === null) return null
  const key = works.find((work) => work.slug === slug)?.key
  return { ...page, details: (await detailsFrom(db)).get(key ?? '') ?? null }
}

export const API = { ...shelf.API, entity }

export type ApiResponses = ApiResponsesOf<typeof API>
