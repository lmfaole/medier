/**
 * The rows every watch-log app shares (`film`, `tv`): the register's genres, countries, companies, keywords, credits
 * and people, and the answer it gave for a title and year, are the same shape in each. Only an app's own watch and
 * title tables, and the viewings built from them, differ, so those stay in `film-tables.ts` and `tv-tables.ts`.
 */

import * as v from "valibot"

/** The head of a watch table: the columns every watch-log app's log line begins with. */
export const watchRowHead = { id: v.number(), watched_on: v.nullable(v.string()) }

/** The tail of a watch table: the fields every log line ends with, before an app's own. */
export const watchRowTail = { rating: v.nullable(v.number()), rewatch: v.number(), note: v.nullable(v.string()), tmdb_id: v.nullable(v.number()) }

/** The columns every watch-log app's viewing has, before the app's own. */
export const viewingRow = { id: v.number(), on: v.nullable(v.string()), title: v.string(), year: v.nullable(v.number()), rating: v.nullable(v.number()), rewatch: v.number(), tmdb_id: v.nullable(v.number()) }

/** The columns every register's title table begins with. */
/** One row of `<prefix>_language`: a language spoken in a title, by ISO 639-1 code, with the register's English name. */
export const WatchLanguageRow = v.object({ tmdb_id: v.number(), code: v.string(), language: v.string() })

export const titleRowHead = { tmdb_id: v.number(), title: v.string(), original_title: v.nullable(v.string()) }

/** The prose every register keeps about a title, in the order it is written. */
export const titleRowProse = { overview: v.nullable(v.string()), tagline: v.nullable(v.string()), poster_path: v.nullable(v.string()), backdrop_path: v.nullable(v.string()), original_language: v.nullable(v.string()) }

/** The register's own rating of a title. */
export const titleRowVotes = { vote_average: v.nullable(v.number()), vote_count: v.nullable(v.number()) }

/** The ids the register has for a title elsewhere. */
export const titleRowIds = { imdb_id: v.nullable(v.string()), wikidata_id: v.nullable(v.string()) }

/** One row of `<prefix>_match`: what the register answered for a title and year. */
export const WatchMatchRow = v.object({
  title: v.string(),
  year: v.number(),
  tmdb_id: v.nullable(v.number()),
  candidates: v.nullable(v.string()),
  tried_at: v.number(),
})

export const WatchGenreRow = v.object({
  tmdb_id: v.number(),
  genre: v.string(),
})

export const WatchCountryRow = v.object({
  tmdb_id: v.number(),
  code: v.string(),
  country: v.string(),
})

/** One row of `<prefix>_credit`: a member of the cast (`job` is `Cast`, `position` the billing order) or of the crew (the app's jobs folded into theirs). */
export const WatchCreditRow = v.object({
  tmdb_id: v.number(),
  person_id: v.number(),
  name: v.string(),
  job: v.string(),
  character: v.nullable(v.string()),
  position: v.number(),
})

export const WatchCompanyRow = v.object({
  tmdb_id: v.number(),
  company: v.string(),
  country: v.nullable(v.string()),
})

export const WatchKeywordRow = v.object({
  tmdb_id: v.number(),
  keyword: v.string(),
})

/** What a page needs to show a work the register names beside another, and where it stands in the list (`position` 0 is the first). */
const workRefTail = {
  title: v.string(),
  day: v.nullable(v.string()),
  poster_path: v.nullable(v.string()),
  position: v.number(),
}

/** One row of `<prefix>_related`: a work the register recommends beside another, best first. */
export const WatchRelatedRow = v.object({ tmdb_id: v.number(), related_id: v.number(), ...workRefTail })

/** One row of `<prefix>_franchise`: a franchise (the register's collection) some work belongs to. */
export const WatchFranchiseRow = v.object({
  franchise_id: v.number(),
  name: v.string(),
  overview: v.nullable(v.string()),
  poster_path: v.nullable(v.string()),
  fetched_at: v.number(),
  backdrop_path: v.nullable(v.string()),
})

/** One row of `<prefix>_franchise_part`: a work of a franchise and the day it came out, the first part at `position` 0. */
export const WatchFranchisePartRow = v.object({ franchise_id: v.number(), tmdb_id: v.number(), ...workRefTail })

/** A part as the pages read it: with its own work's wide picture, which a franchise with none of its own borrows. */
export const WatchFranchisePartLine = v.object({ ...WatchFranchisePartRow.entries, backdrop_path: v.nullable(v.string()) })

/** One row of `<prefix>_person`: what the register says about a person of a credit. */
export const WatchPersonRow = v.object({
  person_id: v.number(),
  name: v.string(),
  birthday: v.nullable(v.string()),
  deathday: v.nullable(v.string()),
  place_of_birth: v.nullable(v.string()),
  biography: v.nullable(v.string()),
  biography_language: v.nullable(v.string()),
  department: v.nullable(v.string()),
  imdb_id: v.nullable(v.string()),
  fetched_at: v.number(),
})

/** The viewings of one watch-log app: its watch table, and what the register matched each title and year to. */
export function watchViewingsSql({ prefix, title, tail }: { prefix: string; title: string; tail: string }): string {
  return `
  SELECT watch.id AS id, watch.watched_on AS "on", watch.${title} AS title, watch.year AS year,
         watch.rating AS rating, watch.rewatch AS rewatch, COALESCE(watch.tmdb_id, match.tmdb_id) AS tmdb_id,
         ${tail}
  FROM ${prefix}_watch AS watch
  LEFT JOIN ${prefix}_match AS match ON match.title = watch.${title} AND match.year = COALESCE(watch.year, 0)
  ORDER BY watch.watched_on IS NULL, watch.watched_on, watch.id`
}

/** The columns every watch-log app's collection has, before the app's own title column: what the owner has or wants. */
export const collectionRow = { id: v.number(), added_on: v.nullable(v.string()) }

/** The collection's own fields, after the title and year: how the owner stands to the work, and what the log says of it. */
export const collectionRowTail = { status: v.string(), rating: v.nullable(v.number()), note: v.nullable(v.string()), tmdb_id: v.nullable(v.number()), format: v.nullable(v.string()) }

/** One line of a collection as the app's page reads it: what the register matched the title and year to is already in `tmdb_id`. */
export const CollectionLine = v.object({ added_on: v.nullable(v.string()), title: v.string(), year: v.nullable(v.number()), status: v.string(), rating: v.nullable(v.number()), tmdb_id: v.nullable(v.number()), format: v.nullable(v.string()) })

/** The collection of one watch-log app, each line with the register's number: the line's own, else what the register matched its title and year to. */
export function watchCollectionSql({ prefix, title }: { prefix: string; title: string }): string {
  return `
  SELECT collection.added_on AS added_on, collection.${title} AS title, collection.year AS year, collection.status AS status, collection.rating AS rating,
         COALESCE(collection.tmdb_id, match.tmdb_id) AS tmdb_id, collection.format AS format
  FROM ${prefix}_collection AS collection
  LEFT JOIN ${prefix}_match AS match ON match.title = collection.${title} AND match.year = COALESCE(collection.year, 0)
  ORDER BY collection.id`
}
