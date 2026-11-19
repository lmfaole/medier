/**
 * The Open Graph tags of every page of every app, one row each in
 * `og-pages.json`. The file is edited by hand and reviewed in git, so a page's
 * preview text and image are content, not code. `pageOg` is what a root route reads. A row's id is
 * `<app>:<path>`, so the app and the page are not typed twice.
 */

import type { OgTagsOptions } from "@designsystem/config/og-tags"
import { fileNameOf } from "@designsystem/config/asset-id"
import * as v from "valibot"

import { ANY_APPS, APP_IDS, HOME_APP_IDS, pageHref, type AnyAppId } from "./apps.ts"
import rows from "./og-pages.json" with { type: "json" }

/** The size an uploaded preview image is announced at in the tags. */
const OG_SIZE = { width: 1200, height: 630 } as const

/** A row as the file holds it, and as the collection spec must match. `image` is an asset id (see `asset-id.ts`). */
export const OgPageRow = v.object({
  id: v.string(),
  title: v.string(),
  description: v.string(),
  /** The page's own `<h1>`, when it is not the title; and the sentence under it, which may name `PLACEHOLDERS`. */
  heading: v.optional(v.string()),
  lead: v.optional(v.string()),
  image: v.optional(v.string()),
})

export interface OgPage {
  app: AnyAppId
  path: string
  title: string
  description: string
  heading?: string
  lead?: string
  image?: string
}

/** The values a page may fill into its lead as `{name}`; a lead naming anything else is a typo (`og-pages.test.ts`). */
export const PLACEHOLDERS = ["count", "first", "last"] as const

/** The app and path of a row id (`budget:/salary` → `budget`, `/salary`), or `undefined` for an id that is not one. */
export function splitId(id: string): { app: AnyAppId; path: string } | undefined {
  const at = id.indexOf(":")
  const app = [...APP_IDS, ...HOME_APP_IDS].find((candidate) => candidate === id.slice(0, at))
  return app && id.charAt(at + 1) === "/" ? { app, path: id.slice(at + 1) } : undefined
}

const PAGES: OgPage[] = v.parse(v.array(OgPageRow), rows).flatMap(({ id, ...row }) => {
  const page = splitId(id)
  return page ? [{ ...page, ...row }] : []
})

/** `/salary/` is `/salary`; the root stays `/`. */
function plain(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname
}

/** The row for `pathname`, else for the nearest page above it (`/toppliste/2025` → `/toppliste`), else the app's own `/`. */
export function pageRow(app: AnyAppId, pathname: string): OgPage | undefined {
  const own = PAGES.filter((row) => row.app === app)
  let path = plain(pathname)
  while (path !== "/") {
    const found = own.find((row) => row.path === path)
    if (found) return found
    path = path.slice(0, Math.max(path.lastIndexOf("/"), 0)) || "/"
  }
  return own.find((row) => row.path === "/")
}

/** The document title and Open Graph tags for a page of `app`, or nothing when no row covers it. */
export function pageOg(app: AnyAppId, pathname: string): { title: string; og: OgTagsOptions } | undefined {
  const row = pageRow(app, pathname)
  if (!row) return undefined
  const origin = ANY_APPS[app].href
  const file = row.image === undefined ? null : fileNameOf(row.image)
  return {
    title: row.title,
    og: {
      title: row.title,
      description: row.description,
      url: pageHref(origin, row.path),
      // An uploaded image is served by the app itself under `/og/`; without one the shared card is used.
      ...(file ? { image: pageHref(origin, `/og/${file}`), imageWidth: OG_SIZE.width, imageHeight: OG_SIZE.height } : {}),
    },
  }
}

/** `text` with each `{name}` replaced from `values`; `undefined` when one has no value, so a half-filled sentence is never shown. */
export function fill(text: string, values: Readonly<Record<string, string | number>> = {}): string | undefined {
  let complete = true
  const filled = text.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = values[name]
    if (value === undefined) complete = false
    return String(value)
  })
  return complete ? filled : undefined
}

/** The `<h1>` and lead a page's header shows, from the row with exactly this id (`<app>:<path>`); nothing for an id with no row. */
export function pageHeader(id: string, values?: Readonly<Record<string, string | number>>): { title?: string; lead?: string } {
  const page = splitId(id)
  const row = page && PAGES.find((candidate) => candidate.app === page.app && candidate.path === page.path)
  if (!row) return {}
  const title = row.heading ?? row.title
  const lead = row.lead === undefined ? undefined : fill(row.lead, values)
  return { title, ...(lead === undefined ? {} : { lead }) }
}
