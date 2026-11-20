/**
 * The two halves of the site, kept apart: the music (Last.fm) and film and TV (Trakt). Each has its overview, its history and its wrapped (a week, a month) under its own address, and asks only for its
 * own username. Old addresses of the shared pages (`/historikk/`, `/uke/…`, `/maned/…`) lead to the music's (`oldAddress`).
 */
import type { Service } from "./users.ts"
import type { Medium } from "./week-source.ts"

export interface MediumInfo {
  /** Its overview, under the site's base: `musikk/`. */
  path: string
  label: string
  service: Service
  /** Its place in the navigation (`Frame`). */
  place: "music" | "film"
}

export const MEDIA: Readonly<Record<Medium, MediumInfo>> = {
  music: { path: "musikk/", label: "Musikk", service: "lastfm", place: "music" },
  film: { path: "film-og-tv/", label: "Film og TV", service: "trakt", place: "film" },
}

/** The pages of a medium: its overview, history, and the wrapped of a week and a month (the address of one, or the place that opens the latest). */
export const mediumHref = (base: string, medium: Medium, page: "" | "historikk/" | "uke/" | "maned/" = "", id?: string): string => `${base}${MEDIA[medium].path}${page}${id === undefined ? "" : `${id}/`}`

/** The music's address of an old one (`/historikk/`, `/uke/2026-47/`, `/maned/2026-11/`), with its query; `null` for any other. */
export function oldAddress(base: string, pathname: string, search: string): string | null {
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : null
  if (rest === null) return null
  const match = /^(historikk|uke|maned)(?:\/([^/]+))?\/?$/.exec(rest)
  if (match === null) return null
  const [, page, id] = match
  return `${mediumHref(base, "music", `${page}/` as "historikk/" | "uke/" | "maned/", id)}${search}`
}
