/**
 * The tables of `db/film.sql` (written by `film-sync`) that the film app reads, and the viewings it counts. The
 * test checks the columns against the schema and the SQL against the cases that made it. What film shares with TV
 * is `watch-tables.ts`; only the watch and title rows are the film's own.
 */

import * as v from "valibot"

import { collectionRow, collectionRowTail, titleRowHead, titleRowIds, titleRowProse, titleRowVotes, viewingRow, watchCollectionSql, watchRowHead, watchRowTail, watchViewingsSql } from "./watch-tables.ts"

export { WatchCompanyRow as FilmCompanyRow, WatchCountryRow as FilmCountryRow, WatchCreditRow as FilmCreditRow, WatchGenreRow as FilmGenreRow, WatchLanguageRow as FilmLanguageRow, WatchKeywordRow as FilmKeywordRow, WatchMatchRow as FilmMatchRow, WatchPersonRow as FilmPersonRow } from "./watch-tables.ts"

/** One row of `film_watch`: a viewing, as the log has it. `watched_on` is `YYYY-MM-DD`, or none when the day is not known. */
export const FilmWatchRow = v.object({
  ...watchRowHead,
  title: v.string(),
  year: v.nullable(v.number()),
  ...watchRowTail,
  cinema: v.nullable(v.string()),
  seat: v.nullable(v.string()),
})

/** One row of `film_collection`: a film the owner has or wants, as `film-collection.csv` has it. */
export const FilmCollectionRow = v.object({
  ...collectionRow,
  title: v.string(),
  year: v.nullable(v.number()),
  ...collectionRowTail,
})

export const FILM_COLLECTION_SQL = watchCollectionSql({ prefix: "film", title: "title" })

/** One row of `film_cinema`: a cinema as the owner described it; a viewing's `cinema` is its `name`. */
export const FilmCinemaRow = v.object({
  name: v.string(),
  owner: v.nullable(v.string()),
  country: v.string(),
  city: v.nullable(v.string()),
  website: v.nullable(v.string()),
  image: v.nullable(v.string()),
})

/** One row of `film_planned`: a cinema visit the calendar has from today on. */
export const FilmPlannedRow = v.object({
  uid: v.string(),
  on_date: v.string(),
  at_time: v.nullable(v.string()),
  title: v.string(),
  cinema: v.nullable(v.string()),
})

/** The upcoming visits, soonest first: what the film front page and the media log show as planned. */
export const FILM_PLANNED_SQL = "SELECT * FROM film_planned ORDER BY on_date, at_time, title"

/** One row of `film_title`: a film, as the register has it. */
export const FilmTitleRow = v.object({
  ...titleRowHead,
  release_date: v.nullable(v.string()),
  runtime_min: v.nullable(v.number()),
  ...titleRowProse,
  fetched_at: v.number(),
  ...titleRowVotes,
  budget: v.nullable(v.number()),
  revenue: v.nullable(v.number()),
  ...titleRowIds,
  certification: v.nullable(v.string()),
  released_no: v.nullable(v.string()),
  collection_id: v.nullable(v.number()),
  collection: v.nullable(v.string()),
})

/** A viewing and the film the register matched it to: the log's own number first, else the register's answer for its title and year. */
export const Viewing = v.object({
  ...viewingRow,
  cinema: v.nullable(v.string()),
  seat: v.nullable(v.string()),
})

export const FILM_VIEWINGS_SQL = watchViewingsSql({ prefix: "film", title: "title", tail: "watch.cinema AS cinema, watch.seat AS seat" })

export { WatchFranchisePartRow as FilmFranchisePartRow, WatchFranchiseRow as FilmFranchiseRow, WatchRelatedRow as FilmRelatedRow } from "./watch-tables.ts"

/** Which franchise each film belongs to, and every franchise with its parts, as the film pages read them. */
export const FILM_FRANCHISE_OF_SQL = "SELECT tmdb_id, collection_id AS franchise_id FROM film_title WHERE collection_id IS NOT NULL"
export const FILM_FRANCHISES_SQL = "SELECT * FROM film_franchise"
/** Each part with its film's own wide picture where the register has the film, which stands in for a franchise with none of its own. */
export const FILM_FRANCHISE_PARTS_SQL =
  "SELECT p.franchise_id, p.tmdb_id, p.title, p.day, p.poster_path, p.position, t.backdrop_path AS backdrop_path FROM film_franchise_part AS p LEFT JOIN film_title AS t ON t.tmdb_id = p.tmdb_id ORDER BY p.franchise_id, p.position"
export const FILM_RELATED_SQL = "SELECT * FROM film_related ORDER BY tmdb_id, position"

