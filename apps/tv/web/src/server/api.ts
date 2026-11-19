/**
 * The API of the TV pages: files built from the local tv database (`tv.db`) by loaders that read the viewings and what
 * the register says about each series (`TV_VIEWINGS_SQL` and the `tv_*` tables) and count them in `tv-stats.ts`.
 * Everything here is published to anyone.
 */

import type { ApiResponsesOf, AppApi } from '@designsystem/config/api-files'
import { queryRows } from '@designsystem/config/d1-query'
import { TV_COLLECTION_SQL, TV_RELATED_SQL, TV_VIEWINGS_SQL, TvCompanyRow, TvCountryRow, TvCreditRow, TvGenreRow, TvKeywordRow, TvLanguageRow, TvNetworkRow, TvNextRow, TvTitleRow, Viewing as ViewingRow } from '@designsystem/contracts/tv-tables'
import { CollectionLine } from '@designsystem/contracts/watch-tables'
import { watchApi } from '@designsystem/watch/api'
import { collectionLinesOf, logOf, peopleOf, readBoth, readExtras, registerOf, sharedTitleOf } from '@designsystem/watch/reader'
import type { WatchCollectionLine } from '@designsystem/watch/viewing'

import { CREW_JOBS, TV, seriesPageOf, type Network, type Viewing } from './tv-stats.ts'

/** The databases the snapshot opens for this API (`scripts/snapshot-app.ts`): the first is its own. */
export const DOMAINS = ['tv'] as const

const SQL = {
  titles: 'SELECT * FROM tv_title',
  genres: 'SELECT * FROM tv_genre ORDER BY tmdb_id, genre',
  countries: 'SELECT * FROM tv_country ORDER BY tmdb_id, country',
  languages: 'SELECT * FROM tv_language ORDER BY tmdb_id, code',
  networks: 'SELECT * FROM tv_network ORDER BY tmdb_id, position',
  credits: 'SELECT * FROM tv_credit ORDER BY tmdb_id, job, position',
  companies: 'SELECT * FROM tv_company ORDER BY tmdb_id, company',
  keywords: 'SELECT * FROM tv_keyword ORDER BY tmdb_id, keyword',
  people: 'SELECT * FROM tv_person',
  next: 'SELECT * FROM tv_next',
}

/** One episode's viewing: what the log says, and a series-level viewing when the log names no episode at all. */
const episodeOf = (row: { season: number | null; episode: number | null }): Viewing['episode'] => (row.season === null && row.episode === null ? null : { season: row.season, episode: row.episode })

type Item = NonNullable<Viewing['item']>

async function loadAll(db: D1Database): Promise<{ viewings: Viewing[]; collection: WatchCollectionLine<Item>[] }> {
  const [rows, collectionRows, titles, genres, countries, languages, networkRows, credits, companies, keywords, nextRows] = await Promise.all([
    queryRows(db, TV_VIEWINGS_SQL, ViewingRow),
    queryRows(db, TV_COLLECTION_SQL, CollectionLine),
    queryRows(db, SQL.titles, TvTitleRow),
    queryRows(db, SQL.genres, TvGenreRow),
    queryRows(db, SQL.countries, TvCountryRow),
    queryRows(db, SQL.languages, TvLanguageRow),
    queryRows(db, SQL.networks, TvNetworkRow),
    queryRows(db, SQL.credits, TvCreditRow),
    queryRows(db, SQL.companies, TvCompanyRow),
    queryRows(db, SQL.keywords, TvKeywordRow),
    queryRows(db, SQL.next, TvNextRow),
  ])
  const nextOf = new Map(nextRows.map((row) => [row.tmdb_id, row]))
  const series = registerOf({
    titles,
    genres,
    countries,
    languages,
    credits,
    companies,
    keywords,
    leadJob: 'Creator',
    crewJobs: CREW_JOBS,
    titleOf: (row) => ({
      ...sharedTitleOf(row, { releasedOn: row.first_air_date, runtimeMinutes: row.episode_runtime_min }),
      firstAirDate: row.first_air_date,
      lastAirDate: row.last_air_date,
      seasons: row.number_of_seasons,
      episodes: row.number_of_episodes,
      status: row.status,
      inProduction: row.in_production === 1,
      homepage: row.homepage,
      next: ((next) => (next === undefined || next.next_air_date === null ? null : { season: next.next_season, episode: next.next_episode, name: next.next_name, airDate: next.next_air_date }))(nextOf.get(row.tmdb_id)),
    }),
  })
  // A series is shown on more than one network; it counts as seen where the register lists one first.
  const shownOn = new Map<number, Network>()
  for (const row of networkRows) {
    if (!shownOn.has(row.tmdb_id)) shownOn.set(row.tmdb_id, { name: row.name, owner: null, country: row.country, city: null, website: null })
  }
  const viewings = rows.map((row) => ({
    ...logOf(row),
    item: row.tmdb_id === null ? null : (series.get(row.tmdb_id) ?? null),
    place: row.tmdb_id === null ? null : (shownOn.get(row.tmdb_id) ?? null),
    episode: episodeOf(row),
  }))
  const collection = collectionLinesOf(collectionRows, series)
  return { viewings, collection }
}

/** Both are read once per database: a snapshot asks for hundreds of files, and each says the same. */
export const { viewingsOf, collectionOf } = readBoth(loadAll)

/** What the register says about each person, by their number; read once per database like the viewings. */
export const personInfoOf = peopleOf(SQL.people)

/** The recommendations beside each series, read once per database. */
export const extrasOf = readExtras({ related: TV_RELATED_SQL })

export const API = watchApi(TV, { viewingsOf, collectionOf, extrasOf, personInfoOf, itemPageOf: seriesPageOf }) satisfies AppApi

export type ApiResponses = ApiResponsesOf<typeof API>
