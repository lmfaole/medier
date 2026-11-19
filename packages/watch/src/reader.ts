/**
 * How a watch-log app reads its database: one answer per database, the viewings with what the register matched each
 * line to, the register's answer about each of the titles those viewings name, and what it says about each person.
 * The app's own is which tables hold its register and what its title says beyond the shared part; the rest is the
 * shape every register has (`@designsystem/contracts/watch-tables`).
 */

import { queryRows } from '@designsystem/config/d1-query'
import { readOnce } from '@designsystem/config/d1-read-once'
import { type CollectionLine, WatchFranchisePartLine, WatchFranchiseRow, WatchPersonRow, WatchRelatedRow } from '@designsystem/contracts/watch-tables'
import type { titleRowHead, titleRowIds, titleRowProse, titleRowVotes } from '@designsystem/contracts/watch-tables'
import * as v from 'valibot'

import { type FranchisePartRow, type RelatedRow, type WatchExtras } from './extras.ts'
import { genreName, productionCountryName, spokenLanguageName } from './names.ts'
import type { Credit, PersonInfo, WatchCollectionLine, WatchItem, WatchViewing } from './viewing.ts'

/** What an app reads once per database: its viewings and its collection, handed out as the two answers the API wants. */
export function readBoth<Viewings, Collection>(load: (db: D1Database) => Promise<{ viewings: Viewings; collection: Collection }>) {
  const all = readOnce(load)
  return { viewingsOf: async (db: D1Database) => (await all(db)).viewings, collectionOf: async (db: D1Database) => (await all(db)).collection }
}

/** The lines of a collection, each with the register's answer for it: the item it matched, or none where nothing was found. */
export function collectionLinesOf<Item extends WatchItem>(rows: readonly v.InferOutput<typeof CollectionLine>[], items: ReadonlyMap<number, Item>): WatchCollectionLine<Item>[] {
  return rows.map((row) => ({ title: row.title, year: row.year, status: row.status === 'owned' ? 'owned' : 'want', rating: row.rating, addedOn: row.added_on, tmdbId: row.tmdb_id, format: row.format, item: row.tmdb_id === null ? null : (items.get(row.tmdb_id) ?? null) }))
}

/** One line of the log as every watch-log app's line, before the register's own item, place and episode. */
export interface LogRow {
  id: number
  on: string | null
  title: string
  year: number | null
  rating: number | null
  rewatch: number
  tmdb_id: number | null
}

/** What the log itself says of one line; the register's own part is the app's. */
export function logOf(row: LogRow): Pick<WatchViewing, 'id' | 'on' | 'title' | 'year' | 'rating' | 'rewatch' | 'tmdbId'> {
  return { id: row.id, on: row.on, title: row.title, year: row.year, rating: row.rating, rewatch: row.rewatch === 1, tmdbId: row.tmdb_id }
}

/** What the register says about each person of a credit, by their number, from the SQL it reads them with. */
export function peopleOf(sql: string): (db: D1Database) => Promise<Map<number, PersonInfo>> {
  return readOnce((db) =>
    queryRows(db, sql, WatchPersonRow).then(
      (rows) =>
        new Map(
          rows.map((row): [number, PersonInfo] => [
            row.person_id,
            { birthday: row.birthday, deathday: row.deathday, placeOfBirth: row.place_of_birth, biography: row.biography, biographyLanguage: row.biography_language, department: row.department, imdbId: row.imdb_id },
          ]),
        ),
    ),
  )
}

/** The rows of one register's title tables: the shared part of a title, the ones above, and the credits by job. */
export interface RegisterRows {
  genres: readonly { tmdb_id: number; genre: string }[]
  countries: readonly { tmdb_id: number; country: string }[]
  languages: readonly { tmdb_id: number; code: string; language: string }[]
  credits: readonly { tmdb_id: number; person_id: number; name: string; job: string; character: string | null }[]
  companies: readonly { tmdb_id: number; company: string }[]
  keywords: readonly { tmdb_id: number; keyword: string }[]
}

/** A title the register held in full: the shared part every title has, and the two lists it keeps for every one of them. */
export interface RegisterItem extends WatchItem {
  companies: string[]
  keywords: string[]
}

/**
 * The register's answer about each title of `titles`, by its number, with what it gave each: the genres, countries,
 * credits, companies and keywords in the rows above are the same shape in every register, and `titleOf` says what the
 * app's own title table holds beyond them.
 */
export function registerOf<Item extends RegisterItem, Row extends { tmdb_id: number }>({ titles, genres, countries, languages, credits, companies, keywords, leadJob, crewJobs, titleOf }: RegisterRows & { titles: readonly Row[]; leadJob: string; crewJobs: readonly string[]; titleOf: (row: Row) => Item }): Map<number, Item> {
  const byId = new Map<number, Item>(titles.map((row): [number, Item] => [row.tmdb_id, titleOf(row)]))
  for (const row of genres) byId.get(row.tmdb_id)?.genres.push(genreName(row.genre))
  for (const row of countries) byId.get(row.tmdb_id)?.countries.push(productionCountryName(row.country))
  for (const row of languages) byId.get(row.tmdb_id)?.languages.push(spokenLanguageName(row.code, row.language))
  for (const row of credits) {
    if (row.job === leadJob || row.job === 'Cast' || crewJobs.some((job) => job === row.job)) byId.get(row.tmdb_id)?.credits.push(creditOf(row))
  }
  for (const row of companies) byId.get(row.tmdb_id)?.companies.push(row.company)
  for (const row of keywords) byId.get(row.tmdb_id)?.keywords.push(row.keyword)
  return byId
}

/** The columns every register's title table has (`titleRowHead`, `-Prose`, `-Votes` and `-Ids` of the contracts). */
type SharedTitleRow = v.InferOutput<v.ObjectSchema<typeof titleRowHead & typeof titleRowProse & typeof titleRowVotes & typeof titleRowIds, undefined>>

/**
 * What a title holds in every register, with the lists the register's other tables fill in after. `releasedOn` is the film's
 * release date or the series' first air date, `runtimeMinutes` the film's or one episode's.
 */
export function sharedTitleOf(row: SharedTitleRow, { releasedOn, runtimeMinutes }: { releasedOn: string | null; runtimeMinutes: number | null }) {
  return {
    tmdbId: row.tmdb_id,
    title: row.title,
    originalTitle: row.original_title,
    year: releasedOn === null ? null : Number(releasedOn.slice(0, 4)) || null,
    runtimeMinutes,
    overview: row.overview,
    tagline: row.tagline,
    posterPath: row.poster_path,
    language: row.original_language,
    genres: [],
    countries: [],
    languages: [],
    backdropPath: row.backdrop_path,
    credits: [],
    voteAverage: row.vote_average,
    voteCount: row.vote_count,
    imdbId: row.imdb_id,
    wikidataId: row.wikidata_id,
    companies: [],
    keywords: [],
  }
}

/** One credit of a title, as the counting speaks it. */
function creditOf({ person_id, name, job, character }: { person_id: number; name: string; job: string; character: string | null }): Credit {
  return { id: person_id, name, job, character }
}

const FranchiseOfLine = v.object({ tmdb_id: v.number(), franchise_id: v.number() })

/** The SQL an app reads the register's extras with: the recommendations always, the franchises (three queries) where it has them. */
export interface ExtrasSql {
  related: string
  franchiseOf?: string
  franchises?: string
  parts?: string
}

/** The recommendations and the franchises, by the register's number, read once per database. */
export function readExtras(sql: ExtrasSql): (db: D1Database) => Promise<WatchExtras> {
  return readOnce(async (db) => {
    const related = new Map<number, RelatedRow[]>()
    for (const row of await queryRows(db, sql.related, WatchRelatedRow)) related.set(row.tmdb_id, [...(related.get(row.tmdb_id) ?? []), row])
    const franchiseOf = new Map<number, number>()
    const franchises = new Map<number, { name: string; backdropPath: string | null; parts: FranchisePartRow[] }>()
    if (sql.franchiseOf !== undefined && sql.franchises !== undefined && sql.parts !== undefined) {
      for (const row of await queryRows(db, sql.franchiseOf, FranchiseOfLine)) franchiseOf.set(row.tmdb_id, row.franchise_id)
      for (const row of await queryRows(db, sql.franchises, WatchFranchiseRow)) franchises.set(row.franchise_id, { name: row.name, backdropPath: row.backdrop_path, parts: [] })
      for (const row of await queryRows(db, sql.parts, WatchFranchisePartLine)) franchises.get(row.franchise_id)?.parts.push(row)
    }
    return { related, franchiseOf, franchises }
  })
}
