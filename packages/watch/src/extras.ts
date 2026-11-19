/**
 * What the register says beside a work, put into the words of a page as pure functions: the works it recommends and the franchise it
 * belongs to, each told whether the owner has seen it and where its page is. The rows are the app's, read once per snapshot; the
 * API hands the results to the page of one work and, for film, to the page of the franchises.
 */

import { backdropUrl, posterUrl, type FranchisePart, type FranchiseShelf, type RelatedWork } from './viewing.ts'

export interface RelatedRow {
  related_id: number
  title: string
  day: string | null
  position: number
}

export interface FranchisePartRow {
  tmdb_id: number
  title: string
  day: string | null
  poster_path: string | null
  /** The part's own film's wide picture, which a franchise with none of its own borrows. */
  backdrop_path: string | null
  position: number
}

export interface WatchExtras {
  /** Each work's recommendations, best first. */
  related: ReadonlyMap<number, readonly RelatedRow[]>
  /** The franchise each work belongs to. */
  franchiseOf: ReadonlyMap<number, number>
  franchises: ReadonlyMap<number, { name: string; backdropPath: string | null; parts: readonly FranchisePartRow[] }>
}

export const NO_EXTRAS: WatchExtras = { related: new Map(), franchiseOf: new Map(), franchises: new Map() }

/** What the owner has: the page of every work with one (seen, owned or wanted) by the register's number, and the numbers seen. */
export interface Known {
  slugs: ReadonlyMap<number, string>
  seen: ReadonlySet<number>
}

const yearOf = (day: string | null): number | null => (day === null ? null : Number(day.slice(0, 4)) || null)

export function relatedWorks(tmdbId: number, extras: WatchExtras, known: Known): RelatedWork[] {
  return (extras.related.get(tmdbId) ?? []).map((row) => ({ title: row.title, year: yearOf(row.day), slug: known.slugs.get(row.related_id) ?? null, seen: known.seen.has(row.related_id) }))
}

function shelfOf(franchiseId: number, extras: WatchExtras, known: Known, current: number | null): FranchiseShelf | null {
  const franchise = extras.franchises.get(franchiseId)
  if (franchise === undefined) return null
  const parts: FranchisePart[] = franchise.parts.map((part) => ({ title: part.title, year: yearOf(part.day), slug: known.slugs.get(part.tmdb_id) ?? null, cover: known.slugs.has(part.tmdb_id) || part.tmdb_id === current ? posterUrl({ posterPath: part.poster_path }) : null, seen: known.seen.has(part.tmdb_id), current: part.tmdb_id === current }))
  return { name: franchise.name, backdrop: backdropUrl({ backdropPath: franchise.backdropPath ?? franchise.parts.findLast((part) => part.backdrop_path !== null)?.backdrop_path ?? null }), seen: parts.filter((part) => part.seen).length, total: parts.length, parts }
}

/** The franchise a work belongs to, with its own part marked; none for a work with no franchise or a franchise of one part. */
export function franchiseOfWork(tmdbId: number, extras: WatchExtras, known: Known): FranchiseShelf | null {
  const id = extras.franchiseOf.get(tmdbId)
  const shelf = id === undefined ? null : shelfOf(id, extras, known, tmdbId)
  return shelf === null || shelf.total < 2 ? null : shelf
}
