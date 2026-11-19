/**
 * The API of a shelf app, the same for all three: files built at snapshot time, by loaders that read the log and the
 * works the register matched out of the app's own database (`shelfLinesSql`). Everything here is published to anyone.
 */

import type { ApiResponsesOf, AppApi } from '@designsystem/config/api-files'
import { queryRows } from '@designsystem/config/d1-query'
import type { SnapshotRequests } from '@designsystem/config/snapshot-files'
import { BOOK_FACTS_SQL, BookFactRow, GAME_ACHIEVEMENTS_SQL, GAME_COMPANIES_SQL, GAME_FACETS_SQL, GAME_PROFILE_SQL, GAME_ROMS_SQL, GAME_TIMES_SQL, GameAchievementLine, GameCompanyRow, GameFacetRow, GameProfileRow, GameRomLine, GameTimeRow, ShelfGenreRow, ShelfLine, shelfGenresSql, shelfHoldingsSql, shelfLinesSql, type ShelfPrefix } from '@designsystem/contracts/shelf-tables'
import { readOnce } from '@designsystem/config/d1-read-once'

import { logoPathOf } from './covers.ts'
import { readingsOf, historyOf, libraryOf, loggedOf, overviewOf, pageOf, worksOf, type ShelfConfig } from './shelf.ts'

export function shelfApi(config: ShelfConfig, prefix: ShelfPrefix) {
  /** The works are read once per database: a snapshot asks for a file for every work, and each says the same. */
  const worksFrom = readOnce(async (db: D1Database) => {
    const [lines, collection, genres, achievements, roms, companies, facets, times, facts] = await Promise.all([
      queryRows(db, shelfLinesSql(prefix), ShelfLine),
      queryRows(db, shelfHoldingsSql(prefix), ShelfLine),
      queryRows(db, shelfGenresSql(prefix), ShelfGenreRow),
      // Only games have achievements and ROMs; the other two databases have no such tables.
      prefix === 'game' ? queryRows(db, GAME_ACHIEVEMENTS_SQL, GameAchievementLine) : Promise.resolve([]),
      prefix === 'game' ? queryRows(db, GAME_ROMS_SQL, GameRomLine) : Promise.resolve([]),
      prefix === 'game' ? queryRows(db, GAME_COMPANIES_SQL, GameCompanyRow) : Promise.resolve([]),
      prefix === 'game' ? queryRows(db, GAME_FACETS_SQL, GameFacetRow) : Promise.resolve([]),
      prefix === 'game' ? queryRows(db, GAME_TIMES_SQL, GameTimeRow) : Promise.resolve([]),
      prefix === 'book' ? queryRows(db, BOOK_FACTS_SQL, BookFactRow) : Promise.resolve([]),
    ])
    return worksOf(lines, genres, config, achievements, collection, roms, companies, { facets, times, facts })
  })

  const profilesFrom = readOnce(async (db: D1Database) => (prefix === 'game' ? readingsOf(await queryRows(db, GAME_PROFILE_SQL, GameProfileRow)) : []))

  const API = {
    overview: async (db: D1Database) => overviewOf(loggedOf(await worksFrom(db)), config, await profilesFrom(db)),
    library: async (db: D1Database) => libraryOf(await worksFrom(db), config),
    history: async (db: D1Database, url: URL) => historyOf(loggedOf(await worksFrom(db)), url.searchParams.get('year')),
    /** Which logo each path is, for the script that lands them (games only): it reads this file and nothing else. */
    companies: async (db: D1Database) => (prefix === 'game' ? (await queryRows(db, GAME_COMPANIES_SQL, GameCompanyRow)).flatMap((company) => { const logo = logoPathOf(company.logo); return logo === null ? [] : [{ logo, logoSource: company.logo }] }) : []),
    /** One page, or `null` (a 404) for a slug no work has. */
    entity: async (db: D1Database, url: URL) => pageOf(await worksFrom(db), config, url.searchParams.get('slug') ?? '', await profilesFrom(db)),
  } satisfies AppApi

  const snapshot: SnapshotRequests = {
    async requests(db) {
      const works = await worksFrom(db)
      const logged = loggedOf(works)
      return [
        '/api/overview.json',
        '/api/library.json',
        '/api/companies.json',
        '/api/history.json',
        ...historyOf(logged, null).years.map((year) => `/api/history.json?year=${year}`),
        ...works.map((work) => `/api/entity.json?slug=${work.slug}`)]
    },
  }

  return { API, snapshot, worksFrom }
}

export type ShelfResponses = ApiResponsesOf<ReturnType<typeof shelfApi>['API']>
