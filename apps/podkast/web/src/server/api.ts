/**
 * The API of the podcast pages: seven files built from the local podcasts database (`podcasts.db`) by
 * loaders that read the plays (`podcastPlaysWithListeningSql`) and count them in `podcast-stats.ts`. Everything
 * here is published to anyone.
 */

import type { ApiResponsesOf, AppApi } from '@designsystem/config/api-files'
import { queryRows } from '@designsystem/config/d1-query'
import { podcastPlaysWithListeningSql, PodcastPlay } from '@designsystem/contracts/podcast-tables'

import { requestedChoice } from '@designsystem/intl/listening'

import { episodeAbout, showAbout } from './about.ts'
import { showPictures } from './covers.ts'
import { entitiesOf, monthOf, episodePageOf, showPageOf, showSlug, monthsOf, perHour, perMonth, perWeekday, perYear, recentOf, topShows, totalsOf } from './podcast-stats.ts'

/** The databases the snapshot opens for this API (`scripts/snapshot-app.ts`): the first is its own, the second the gpodder log's. */
export const DOMAINS = ['podcasts', 'podcast_history'] as const

const RECENT_LIMIT = 20

/** The plays are read once per database: a snapshot asks for hundreds of files, and the plays are the same for each. */
const read = new WeakMap<D1Database, ReturnType<typeof queryRows<typeof PodcastPlay>>>()

export function playsOf(db: D1Database) {
  const cached = read.get(db)
  if (cached !== undefined) return cached
  const plays = queryRows(db, podcastPlaysWithListeningSql(), PodcastPlay)
  read.set(db, plays)
  return plays
}

/**
 * Every play of one month, newest first, of every source: Spotify's export, the scrobbles and what the player recorded
 * through gpodder, the one history «Sist spilt» is the top of. A month at a time, since all of it is thousands of rows.
 */
async function history(db: D1Database, url: URL) {
  const [plays, pictures] = await Promise.all([playsOf(db), showPictures(db)])
  const months = monthsOf(plays)
  const month = requestedChoice(url.searchParams.get('month'), months)
  // Each play with its show's picture, the one every episode of it is shown with.
  return { month, months, plays: plays.filter((play) => monthOf(play.at) === month).toReversed().map((play) => ({ ...play, cover: pictures.paths.get(play.show) ?? null })) }
}

async function overview(db: D1Database) {
  const [plays, pictures] = await Promise.all([playsOf(db), showPictures(db)])
  return {
    totals: totalsOf(plays),
    years: perYear(plays),
    months: perMonth(plays),
    weekdays: perWeekday(plays),
    hours: perHour(plays),
    // The shows that lead are a gallery: each has its page's slug and its picture.
    topShows: topShows(plays, 5).map((show) => ({ ...show, slug: showSlug(show.name), cover: pictures.paths.get(show.name) ?? null })),
    recent: recentOf(plays, RECENT_LIMIT).map((play) => ({ ...play, cover: pictures.paths.get(play.show) ?? null })),
  }
}

const indexed = new WeakMap<D1Database, Promise<ReturnType<typeof entitiesOf>>>()

/** The index of pages, built once per database like the plays it comes from. */
function entities(db: D1Database) {
  const cached = indexed.get(db)
  if (cached !== undefined) return cached
  const index = Promise.all([playsOf(db), showPictures(db)]).then(([plays, pictures]) => entitiesOf(plays, pictures.paths))
  indexed.set(db, index)
  return index
}

/** One page: a show or an episode by its slug, or `null` (a 404) for a slug there is none of. */
async function entity(db: D1Database, url: URL) {
  const kind = url.searchParams.get('kind')
  const slug = url.searchParams.get('slug')
  const found = (await entities(db)).find((candidate) => candidate.kind === kind && candidate.slug === slug)
  if (found === undefined) return null
  const plays = await playsOf(db)
  if (found.kind === 'show') {
    const page = showPageOf(plays, found.name)
    return page === null ? null : { ...page, cover: found.cover, about: await showAbout(db, found.name) }
  }
  const page = episodePageOf(plays, found.show ?? '', found.name)
  return page === null ? null : { ...page, cover: found.cover, about: await episodeAbout(db, found.show ?? '', found.name) }
}

/** Which picture each path is, for the script that lands them: it reads this file and nothing else. */
async function covers(db: D1Database) {
  return (await showPictures(db)).files
}

export const API = { overview, entities, entity, history, covers } satisfies AppApi

export type ApiResponses = ApiResponsesOf<typeof API>
