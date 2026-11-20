/**
 * The detail pages: one for each film or show in the history (`/film-og-tv/<slug>/`) and one for each artist played (`/musikk/<slug>/`), with
 * what the data holds about it. Pure, so a test pins which pages there are and what each one holds; the pages in `src/pages/` only show it.
 */

import type { Music, Play } from "./lastfm.ts"
import type { TitleInfo } from "./tmdb.ts"
import type { Watch } from "./trakt.ts"

/** A name as a part of an address: lower case, Norwegian letters spelled out, anything else a dash. */
export function slugify(text: string): string {
  const plain = text.toLowerCase().replaceAll("æ", "ae").replaceAll("ø", "o").normalize("NFKD").replace(/[̀-ͯ]/g, "")
  return plain.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "uten-navn"
}

export interface TitlePage {
  slug: string
  kind: "film" | "episode"
  title: string
  year: number | null
  poster: string | null
  /** What TMDB says of it: plot, genres, length, vote; `null` until it has been asked. */
  info: TitleInfo | null
  /** The film's or the show's page on Trakt (not an episode's). */
  traktUrl: string
  /** Every viewing of it in the history, newest first. */
  viewings: Watch[]
}

const TRAKT = /^https:\/\/trakt\.tv\/(movies|shows)\/([^/]+)/

/** Trakt's own slug where the address has one, so a page keeps its address; a film and a show with the same slug are told apart. */
export function titlePages(items: readonly Watch[]): TitlePage[] {
  const byKey = new Map<string, TitlePage>()
  const slugs = new Set<string>()
  for (const watch of items) {
    const match = TRAKT.exec(watch.url)
    const base = match?.[2] ?? slugify(watch.title)
    const key = `${watch.kind}:${base}`
    const found = byKey.get(key)
    if (found !== undefined) {
      found.viewings.push(watch)
      found.poster ??= watch.poster
      found.info ??= watch.info
      continue
    }
    const slug = slugs.has(base) ? `${base}-${watch.kind === "film" ? "film" : "serie"}` : base
    slugs.add(slug)
    const traktUrl = match === null ? "https://trakt.tv" : `https://trakt.tv/${match[1]}/${base}`
    byKey.set(key, { slug, kind: watch.kind, title: watch.title, year: watch.year, poster: watch.poster, info: watch.info, traktUrl, viewings: [watch] })
  }
  return [...byKey.values()]
}

export interface ArtistPage {
  slug: string
  name: string
  /** The artist on Last.fm. */
  url: string
  /** The plays in the recent list, newest first. */
  plays: Play[]
  /** Place and plays among the most played of the last month, where it is one of them. */
  top: { rank: number; plays: number } | null
}

/** «https://www.last.fm/music/Artist/_/Track» is the track; the artist is the part before `/_/`. */
const artistUrl = (trackUrl: string): string => trackUrl.split("/_/")[0] ?? trackUrl

export function artistPages(music: Pick<Music, "recent" | "topArtists">): ArtistPage[] {
  const pages = new Map<string, ArtistPage>()
  const page = (name: string, url: string): ArtistPage => {
    const slug = slugify(name)
    const existing = pages.get(slug)
    if (existing !== undefined) return existing
    const made: ArtistPage = { slug, name, url, plays: [], top: null }
    pages.set(slug, made)
    return made
  }
  music.topArtists.forEach((artist, index) => {
    page(artist.name, artist.url).top = { rank: index + 1, plays: artist.plays }
  })
  for (const play of music.recent) page(play.artist, artistUrl(play.url)).plays.push(play)
  return [...pages.values()]
}

export const titleHref = (base: string, slug: string): string => `${base}film-og-tv/${slug}/`
export const artistHref = (base: string, name: string): string => `${base}musikk/${slugify(name)}/`
