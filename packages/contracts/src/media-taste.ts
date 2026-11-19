/**
 * What the owner's taste adds up to, counted from the databases of the media apps: the films and series seen (their
 * genres, decades, directors or creators, cast and countries) and the music (the artists and genres scrobbled most, and
 * what was heard with no scrobble). Read by `forside` (`/medier`, the databases attached) and by `npm run seen --
 * profile` (each opened alone), so the queries take the name a database's tables go by: empty when it is the one
 * opened, `film.` when it is attached. The test runs each against the schemas.
 */

import * as v from "valibot"

import { MUSIC_ONLY_SQL } from "./music-tables.ts"

/** One line of a ranked list: what is counted, and how many. */
export const CountRow = v.object({ label: v.string(), n: v.number() })

/** How many items and how many viewings of them a log has. */
export const WatchTotalsRow = v.object({ items: v.number(), viewings: v.number(), rating: v.nullable(v.number()) })

export const TASTE_LIMIT = 8

export type WatchDomain = "film" | "tv"

/** The log's viewings with the register's number: the log's own, else the match for its title and year. */
function viewings(domain: WatchDomain, qualifier: string): { from: string; id: string } {
  const name = domain === "film" ? "title" : "series"
  return {
    from: `FROM ${qualifier}${domain}_watch AS w LEFT JOIN ${qualifier}${domain}_match AS m ON m.title = w.${name} AND m.year = COALESCE(w.year, 0)`,
    id: "COALESCE(w.tmdb_id, m.tmdb_id)",
  }
}

/** The queries of one log: its totals and its ranked lists, each of `CountRow`s (the totals of `WatchTotalsRow`). */
export function watchTasteSql(domain: WatchDomain, qualifier = "") {
  const { from, id } = viewings(domain, qualifier)
  const date = domain === "film" ? "release_date" : "first_air_date"
  const lead = domain === "film" ? "Director" : "Creator"
  const ranked = (join: string, label: string, limit = TASTE_LIMIT) =>
    `SELECT ${label} AS label, count(DISTINCT ${id}) AS n ${from} ${join} GROUP BY label ORDER BY n DESC, label LIMIT ${limit}`
  const title = `JOIN ${qualifier}${domain}_title AS t ON t.tmdb_id = ${id} WHERE t.${date} IS NOT NULL`
  return {
    totals: `SELECT count(DISTINCT ${id}) AS items, count(*) AS viewings, round(avg(w.rating), 2) AS rating ${from}`,
    genres: ranked(`JOIN ${qualifier}${domain}_genre AS g ON g.tmdb_id = ${id}`, "g.genre"),
    decades: ranked(title, `(substr(t.${date}, 1, 3) || '0-tallet')`, 6),
    lead: ranked(`JOIN ${qualifier}${domain}_credit AS c ON c.tmdb_id = ${id} AND c.job = '${lead}'`, "c.name"),
    cast: ranked(`JOIN ${qualifier}${domain}_credit AS c ON c.tmdb_id = ${id} AND c.job = 'Cast'`, "c.name"),
    countries: ranked(`JOIN ${qualifier}${domain}_country AS c ON c.tmdb_id = ${id}`, "c.country", 6),
  }
}

/** The music queries, on the `music` database as the main one. */
export const MUSIC_TASTE_SQL = {
  listens: "SELECT count(*) AS n FROM listens",
  artists: `SELECT artist_name AS label, count(*) AS n FROM listens WHERE ${MUSIC_ONLY_SQL} GROUP BY artist_name ORDER BY n DESC, label LIMIT 10`,
  genres: `SELECT g.genre AS label, count(*) AS n FROM listens JOIN recording_genres AS g ON g.recording_mbid = listens.recording_mbid WHERE ${MUSIC_ONLY_SQL} GROUP BY g.genre ORDER BY n DESC, label LIMIT 10`,
  heard: "SELECT kind AS label, count(*) AS n FROM music_heard GROUP BY kind ORDER BY label",
  heardGenres: `SELECT j.value AS label, count(*) AS n FROM music_heard, json_each(music_heard.genres) AS j GROUP BY j.value ORDER BY n DESC, label LIMIT ${TASTE_LIMIT}`,
} as const
