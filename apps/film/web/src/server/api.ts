/**
 * The API of the film pages: files built from the local film database (`film.db`) by loaders that read the viewings
 * and what the register says about each film (`FILM_VIEWINGS_SQL` and the `film_*` tables) and count them in
 * `film-stats.ts`. Everything here is published to anyone.
 */

import type { ApiResponsesOf, AppApi } from '@designsystem/config/api-files'
import { queryRows } from '@designsystem/config/d1-query'
import { FILM_COLLECTION_SQL, FILM_FRANCHISE_OF_SQL, FILM_FRANCHISE_PARTS_SQL, FILM_FRANCHISES_SQL, FILM_PLANNED_SQL, FILM_RELATED_SQL, FILM_VIEWINGS_SQL, FilmCinemaRow, FilmCompanyRow, FilmCountryRow, FilmCreditRow, FilmGenreRow, FilmKeywordRow, FilmLanguageRow, FilmPlannedRow, FilmTitleRow, Viewing as ViewingRow } from '@designsystem/contracts/film-tables'
import { CollectionLine } from '@designsystem/contracts/watch-tables'
import { cinemaImagePath } from '@designsystem/config/cinema-image'
import { countryName } from '@designsystem/intl/listening'
import { watchApi } from '@designsystem/watch/api'
import { collectionLinesOf, logOf, peopleOf, readBoth, readExtras, registerOf, sharedTitleOf } from '@designsystem/watch/reader'
import { watchCore } from '@designsystem/watch/viewing'
import type { WatchCollectionLine } from '@designsystem/watch/viewing'

import { CREW_JOBS, FILM, filmPageOf, type Cinema, type Viewing } from './film-stats.ts'

const core = watchCore(FILM)

/** The databases the snapshot opens for this API (`scripts/snapshot-app.ts`): the first is its own. */
export const DOMAINS = ['film'] as const

const SQL = {
  titles: 'SELECT * FROM film_title',
  genres: 'SELECT * FROM film_genre ORDER BY tmdb_id, genre',
  countries: 'SELECT * FROM film_country ORDER BY tmdb_id, country',
  languages: 'SELECT * FROM film_language ORDER BY tmdb_id, code',
  credits: 'SELECT * FROM film_credit ORDER BY tmdb_id, job, position',
  companies: 'SELECT * FROM film_company ORDER BY tmdb_id, company',
  keywords: 'SELECT * FROM film_keyword ORDER BY tmdb_id, keyword',
  people: 'SELECT * FROM film_person',
  cinemas: 'SELECT * FROM film_cinema',
}

type Item = NonNullable<Viewing['item']>

async function loadAll(db: D1Database): Promise<{ viewings: Viewing[]; collection: WatchCollectionLine<Item>[] }> {
  const [rows, collectionRows, titles, genres, countries, languages, credits, companies, keywords, cinemaRows] = await Promise.all([
    queryRows(db, FILM_VIEWINGS_SQL, ViewingRow),
    queryRows(db, FILM_COLLECTION_SQL, CollectionLine),
    queryRows(db, SQL.titles, FilmTitleRow),
    queryRows(db, SQL.genres, FilmGenreRow),
    queryRows(db, SQL.countries, FilmCountryRow),
    queryRows(db, SQL.languages, FilmLanguageRow),
    queryRows(db, SQL.credits, FilmCreditRow),
    queryRows(db, SQL.companies, FilmCompanyRow),
    queryRows(db, SQL.keywords, FilmKeywordRow),
    queryRows(db, SQL.cinemas, FilmCinemaRow),
  ])
  const cinemas = new Map(cinemaRows.map((row): [string, Cinema] => [row.name, { ...row, image: row.image === null ? null : cinemaImagePath(row.image) }]))
  const films = registerOf({
    titles,
    genres,
    countries,
    languages,
    credits,
    companies,
    keywords,
    leadJob: 'Director',
    crewJobs: CREW_JOBS,
    titleOf: (row) => ({
      ...sharedTitleOf(row, { releasedOn: row.release_date, runtimeMinutes: row.runtime_min }),
      budget: row.budget,
      revenue: row.revenue,
      certification: row.certification,
      releasedNo: row.released_no,
      collection: row.collection,
    }),
  })
  const viewings = rows.map((row) => ({
    ...logOf(row),
    item: row.tmdb_id === null ? null : (films.get(row.tmdb_id) ?? null),
    place: row.cinema === null ? null : (cinemas.get(row.cinema) ?? { name: row.cinema, owner: null, country: null, city: null, website: null }),
    seat: row.seat,
    episode: null,
  }))
  const collection = collectionLinesOf(collectionRows, films)
  return { viewings, collection }
}

/** Both are read once per database: a snapshot asks for hundreds of files, and each says the same. */
export const { viewingsOf, collectionOf } = readBoth(loadAll)

/** What the register says about each person, by their number; read once per database like the viewings. */
export const personInfoOf = peopleOf(SQL.people)

/** The visits the calendar has planned from today on. */
async function plannedOf(db: D1Database) {
  return (await queryRows(db, FILM_PLANNED_SQL, FilmPlannedRow)).map((row) => ({ on: row.on_date, at: row.at_time, title: row.title, cinema: row.cinema }))
}

/** The recommendations beside each film and the franchise of each, with every part, read once per database. */
export const extrasOf = readExtras({ related: FILM_RELATED_SQL, franchiseOf: FILM_FRANCHISE_OF_SQL, franchises: FILM_FRANCHISES_SQL, parts: FILM_FRANCHISE_PARTS_SQL })

/** The cinemas the owner has been to, most visited first: each with its visits, the films seen there, the first and the last day. */
async function visitedCinemas(db: D1Database) {
  const found = new Map<string, { place: Cinema; visits: number; films: Set<string>; days: string[] }>()
  for (const viewing of await viewingsOf(db)) {
    if (viewing.place === null) continue
    const cinema = found.get(viewing.place.name) ?? { place: viewing.place, visits: 0, films: new Set<string>(), days: [] }
    cinema.visits += 1
    cinema.films.add(viewing.item?.tmdbId === undefined ? viewing.title.toLowerCase() : String(viewing.item.tmdbId))
    if (viewing.on !== null) cinema.days.push(viewing.on)
    found.set(viewing.place.name, cinema)
  }
  const listed = [...found.values()].map(({ place, visits, films, days }) => {
    const sorted = days.toSorted()
    return { name: place.name, slug: core.placeSlug(place.name), owner: place.owner, city: place.city, country: place.country === null ? null : countryName(place.country), image: place.image ?? null, visits, films: films.size, first: sorted.at(0) ?? null, last: sorted.at(-1) ?? null }
  })
  return { cinemas: listed.toSorted((a, b) => b.visits - a.visits || a.name.localeCompare(b.name, 'nb')) }
}

export const API = { ...watchApi(FILM, { viewingsOf, collectionOf, extrasOf, plannedOf, personInfoOf, itemPageOf: filmPageOf }), cinemas: visitedCinemas } satisfies AppApi

export type ApiResponses = ApiResponsesOf<typeof API>
