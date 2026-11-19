/**
 * What the podcasts are, from `podcast_show_info`, `podcast_feed_episode`, `podcast_person` and
 * `podcast_show_country` (`music-sync podcast-feeds` fills them from the shows' own feeds). A description is the
 * publisher's text, so the pages show an excerpt and a link to the source, not the whole.
 */

import type * as v from 'valibot'

import { queryRows } from '@designsystem/config/d1-query'
import { PodcastFeedEpisodeRow, PodcastPersonRow, PodcastShowCountryRow, PodcastShowInfoRow } from '@designsystem/contracts/podcast-tables'

import { excerpt, normalizeTitle } from '@designsystem/intl/text'

const SQL = {
  info: 'SELECT * FROM podcast_show_info WHERE show_name = ?',
  country: 'SELECT * FROM podcast_show_country WHERE show_name = ?',
  people: 'SELECT * FROM podcast_person WHERE show_name = ? AND episode_guid = ? ORDER BY role, name',
  episodes: 'SELECT * FROM podcast_feed_episode WHERE show_name = ?',
}

const SHOW_EXCERPT = 700
const EPISODE_EXCERPT = 600

export interface Person {
  name: string
  role: string
  href: string | null
}

export interface ShowAbout {
  title: string
  author: string | null
  owner: string | null
  language: string | null
  /** Where the show is made, written by hand («(gjetning)» after a guess); `null` where nobody has said. */
  country: string | null
  genre: string | null
  description: string | null
  website: string | null
  appleUrl: string | null
  feedUrl: string | null
  people: Person[]
}

export interface EpisodeAbout {
  description: string | null
  publishedAt: number | null
  durationSeconds: number | null
  link: string | null
  season: number | null
  episode: number | null
  people: Person[]
}

const people = async (db: D1Database, show: string, guid: string): Promise<Person[]> =>
  (await queryRows(db, SQL.people, PodcastPersonRow, show, guid)).map((row) => ({ name: row.name, role: row.role, href: row.href }))

/** What is known of a show, or `null` where its feed was not found. */
export async function showAbout(db: D1Database, show: string): Promise<ShowAbout | null> {
  const [info] = await queryRows(db, SQL.info, PodcastShowInfoRow, show)
  if (info === undefined) return null
  const [country] = await queryRows(db, SQL.country, PodcastShowCountryRow, show)
  return {
    title: info.title,
    author: info.author,
    owner: info.owner_name,
    language: info.language,
    country: country === undefined ? null : country.note?.startsWith('Guess') ? `${country.country} (gjetning)` : country.country,
    genre: info.genre,
    description: info.description === null ? null : excerpt(info.description, SHOW_EXCERPT),
    website: info.website,
    appleUrl: info.apple_url,
    feedUrl: info.feed_url,
    people: await people(db, show, ''),
  }
}

/** The feed episodes of each show, once per database: the snapshot looks up every episode and each would read the whole show again. */
const feedEpisodes = new WeakMap<D1Database, Map<string, Promise<v.InferOutput<typeof PodcastFeedEpisodeRow>[]>>>()

function feedEpisodesOf(db: D1Database, show: string) {
  const byShow = feedEpisodes.get(db) ?? new Map<string, Promise<v.InferOutput<typeof PodcastFeedEpisodeRow>[]>>()
  feedEpisodes.set(db, byShow)
  const cached = byShow.get(show)
  if (cached !== undefined) return cached
  const rows = queryRows(db, SQL.episodes, PodcastFeedEpisodeRow, show)
  byShow.set(show, rows)
  return rows
}

/** What the show's feed says of an episode, found by its title, or `null` where the feed does not have it (a feed keeps only its newest). */
export async function episodeAbout(db: D1Database, show: string, title: string): Promise<EpisodeAbout | null> {
  const wanted = normalizeTitle(title)
  const found = (await feedEpisodesOf(db, show)).find((row) => normalizeTitle(row.title) === wanted)
  if (found === undefined) return null
  return {
    description: found.description === null ? null : excerpt(found.description, EPISODE_EXCERPT),
    publishedAt: found.published_at,
    durationSeconds: found.duration_s,
    link: found.link,
    season: found.season,
    episode: found.episode,
    people: await people(db, show, found.guid),
  }
}

