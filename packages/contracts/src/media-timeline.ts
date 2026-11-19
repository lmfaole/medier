/**
 * What the front page of the media apps (`forside`, `/medier`) reads from seven databases to show the latest of each: a
 * listen, a play, a film, a series, a game, a book and a board game. The first database of the app's `DOMAINS` is `music`,
 * the others are attached under their own name (`podcasts.`, `film.`, `tv.`, `games.`, …). The test runs each query against the schemas and the cases that made it.
 */

import * as v from "valibot"

import { MUSIC_ONLY_SQL } from "./music-tables.ts"
import { podcastPlaysWithListeningSql } from "./podcast-tables.ts"
import type { ShelfPrefix } from "./shelf-tables.ts"

/** How many of each service the timeline reads: as many as the whole list shows, so the newest of all are exact whichever service they come from. */
export const TIMELINE_PER_SERVICE = 50

/**
 * `image` is what the service's own app builds its picture from, as that app reads it: a Cover Art Archive id
 * (`<release>/<image>`) for music, the feed's address for a show, TMDB's file for a film or a series, the register's
 * address for a game or a book. `@designsystem/timeline` turns it into the path the owning app serves it at.
 */
const image = v.nullable(v.string())

/** A listen or a play, with the second it began (Unix seconds). */
export const TimedRow = v.object({ at: v.number(), title: v.string(), subtitle: v.nullable(v.string()), image })

/** A viewing, with the day only: the log has no clock. */
export const DayRow = v.object({ day: v.string(), title: v.string(), subtitle: v.nullable(v.string()), image })

/** A line of a shelf app's log: the day, and the second where the source knew it. */
export const ShelfDayRow = v.object({ ...DayRow.entries, at: v.nullable(v.number()) })

/** The cover of a listen: the recording's own, else its release's, else its release group's, as the music app's front page finds it. */
export const TIMELINE_MUSIC_SQL = `
  SELECT listened_at AS at, track_name AS title, artist_name AS subtitle,
    COALESCE(
      CASE WHEN metadata.caa_release_mbid IS NOT NULL AND metadata.caa_id IS NOT NULL THEN metadata.caa_release_mbid || '/' || metadata.caa_id END,
      CASE WHEN by_release.caa_id IS NOT NULL THEN by_release.caa_release_mbid || '/' || by_release.caa_id END,
      CASE WHEN by_group.caa_id IS NOT NULL THEN by_group.caa_release_mbid || '/' || by_group.caa_id END) AS image
  FROM listens LEFT JOIN recording_metadata AS metadata USING (recording_mbid)
    LEFT JOIN release_cover AS by_release ON by_release.source_mbid = listens.release_mbid
    LEFT JOIN release_cover AS by_group ON by_group.source_mbid = metadata.release_group_mbid
  WHERE ${MUSIC_ONLY_SQL}
  ORDER BY listened_at DESC LIMIT ${TIMELINE_PER_SERVICE}`

/** The plays query of the podcast pages (with what the player recorded), read through the attached `podcasts` database. */
const PODCASTS_ATTACHED = podcastPlaysWithListeningSql("podcasts.")

export const TIMELINE_PODCASTS_SQL = `
  SELECT plays.at, plays.episode AS title, plays.show AS subtitle, info.image_url AS image
  FROM (${PODCASTS_ATTACHED}) AS plays LEFT JOIN podcasts.podcast_show_info AS info ON info.show_name = plays.show
  ORDER BY plays.at DESC LIMIT ${TIMELINE_PER_SERVICE}`

/** A film line: the day, and the clock where the calendar knows the visit (a cinema visit); the subtitle is its cinema, else its year. */
export const FilmDayRow = v.object({ ...DayRow.entries, time: v.nullable(v.string()) })

/**
 * Each viewing, a visit from the calendar once: a viewing logged ahead of its day (a ticket mail) and the calendar's
 * event for it are one line with its time and cinema, and a planned visit the log lacks is a line of its own.
 */
export const TIMELINE_FILM_SQL = `
  SELECT day, time, title, subtitle, image FROM (
    SELECT watch.watched_on AS day, plan.at_time AS time, watch.id AS sort,
           COALESCE(title.title, watch.title) AS title,
           COALESCE(plan.cinema, CAST(COALESCE(watch.year, substr(title.release_date, 1, 4)) AS TEXT)) AS subtitle,
           title.poster_path AS image
    FROM film.film_watch AS watch
    LEFT JOIN film.film_match AS match ON match.title = watch.title AND match.year = COALESCE(watch.year, 0)
    LEFT JOIN film.film_title AS title ON title.tmdb_id = COALESCE(watch.tmdb_id, match.tmdb_id)
    LEFT JOIN film.film_planned AS plan ON plan.on_date = watch.watched_on AND lower(plan.title) = lower(watch.title)
    WHERE watch.watched_on IS NOT NULL
    UNION ALL
    SELECT plan.on_date, plan.at_time, 1000000000, plan.title, plan.cinema, NULL
    FROM film.film_planned AS plan
    WHERE NOT EXISTS (SELECT 1 FROM film.film_watch AS watch WHERE watch.watched_on = plan.on_date AND lower(watch.title) = lower(plan.title))
  )
  ORDER BY day DESC, sort DESC LIMIT ${TIMELINE_PER_SERVICE}`

/** A series once a day, however many episodes of it that day: «3 episoder», or the one episode. */
export const TIMELINE_TV_SQL = `
  SELECT day, title,
         CASE WHEN episodes = 1 THEN 'Sesong ' || season || ', episode ' || episode ELSE episodes || ' episoder' END AS subtitle, image
  FROM (
    SELECT watch.watched_on AS day, COALESCE(title.title, watch.series) AS title, COUNT(*) AS episodes,
           MAX(watch.season) AS season, MAX(watch.episode) AS episode, MAX(title.poster_path) AS image
    FROM tv.tv_watch AS watch
    LEFT JOIN tv.tv_match AS match ON match.title = watch.series AND match.year = COALESCE(watch.year, 0)
    LEFT JOIN tv.tv_title AS title ON title.tmdb_id = COALESCE(watch.tmdb_id, match.tmdb_id)
    WHERE watch.watched_on IS NOT NULL
    GROUP BY watch.watched_on, COALESCE(watch.tmdb_id, match.tmdb_id, watch.series)
  )
  ORDER BY day DESC, title LIMIT ${TIMELINE_PER_SERVICE}`

/** The newest dated lines of one shelf app's log (read through the attached `schema`), with the work's maker where the register has it. */
export function shelfTimelineSql(prefix: ShelfPrefix, schema: string): string {
  return `
  SELECT entry.on_date AS day, entry.at, COALESCE(item.title, entry.title) AS title, item.creator AS subtitle, item.cover AS image
  FROM ${schema}.${prefix}_entry AS entry
  LEFT JOIN ${schema}.${prefix}_match AS match ON match.title = entry.title AND match.year = COALESCE(entry.year, 0)
  LEFT JOIN ${schema}.${prefix}_item AS item ON item.ext_id = COALESCE(entry.ext_id, match.ext_id)
  WHERE entry.on_date IS NOT NULL
  ORDER BY entry.on_date DESC, COALESCE(entry.at, 0) DESC, entry.id DESC LIMIT ${TIMELINE_PER_SERVICE}`
}
