/**
 * The tables of `db/tv.sql` (written by `tv-sync`) that the TV app reads, and the viewings it counts. The test
 * checks the columns against the schema and the SQL against the cases that made it. What TV shares with film is
 * `watch-tables.ts`; only the watch, title and network rows are the TV's own.
 */

import * as v from "valibot"

import { collectionRow, collectionRowTail, titleRowHead, titleRowIds, titleRowProse, titleRowVotes, viewingRow, watchRowHead, watchRowTail, watchCollectionSql, watchViewingsSql } from "./watch-tables.ts"

export { WatchCompanyRow as TvCompanyRow, WatchCountryRow as TvCountryRow, WatchCreditRow as TvCreditRow, WatchGenreRow as TvGenreRow, WatchLanguageRow as TvLanguageRow, WatchKeywordRow as TvKeywordRow, WatchMatchRow as TvMatchRow, WatchPersonRow as TvPersonRow } from "./watch-tables.ts"

/** One row of `tv_watch`: an episode watched, as the log has it. `watched_on` is `YYYY-MM-DD`, or none when the day is not known. */
export const TvWatchRow = v.object({
  ...watchRowHead,
  series: v.string(),
  year: v.nullable(v.number()),
  season: v.nullable(v.number()),
  episode: v.nullable(v.number()),
  ...watchRowTail,
})

/** One row of `tv_title`: a series, as the register has it. */
export const TvTitleRow = v.object({
  ...titleRowHead,
  first_air_date: v.nullable(v.string()),
  last_air_date: v.nullable(v.string()),
  number_of_seasons: v.nullable(v.number()),
  number_of_episodes: v.nullable(v.number()),
  episode_runtime_min: v.nullable(v.number()),
  ...titleRowProse,
  status: v.nullable(v.string()),
  in_production: v.nullable(v.number()),
  homepage: v.nullable(v.string()),
  fetched_at: v.number(),
  ...titleRowVotes,
  ...titleRowIds,
})

/** One row of `tv_collection`: a series the owner has or wants, as `tv-collection.csv` has it. */
export const TvCollectionRow = v.object({
  ...collectionRow,
  series: v.string(),
  year: v.nullable(v.number()),
  ...collectionRowTail,
})

export const TV_COLLECTION_SQL = watchCollectionSql({ prefix: "tv", title: "series" })

/** One row of `tv_next`: when the next episode of a series comes out, from TVmaze. */
export const TvNextRow = v.object({
  tmdb_id: v.number(),
  tvmaze_id: v.number(),
  next_season: v.nullable(v.number()),
  next_episode: v.nullable(v.number()),
  next_name: v.nullable(v.string()),
  next_air_date: v.nullable(v.string()),
  fetched_at: v.number(),
})

/** One row of `tv_network`: a channel or service a series belongs to; a viewing's place is one of them. */
export const TvNetworkRow = v.object({
  tmdb_id: v.number(),
  network_id: v.number(),
  name: v.string(),
  country: v.nullable(v.string()),
  position: v.number(),
})

/** One episode watched and the series the register matched it to: the log's own number first, else the register's answer for its series and year. */
export const Viewing = v.object({
  ...viewingRow,
  season: v.nullable(v.number()),
  episode: v.nullable(v.number()),
})

export const TV_VIEWINGS_SQL = watchViewingsSql({ prefix: "tv", title: "series", tail: "watch.season AS season, watch.episode AS episode" })

export { WatchRelatedRow as TvRelatedRow } from "./watch-tables.ts"

/** The recommendations beside each series, best first, as the tv pages read them. */
export const TV_RELATED_SQL = "SELECT * FROM tv_related ORDER BY tmdb_id, position"

