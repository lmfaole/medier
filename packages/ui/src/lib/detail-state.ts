/**
 * The page of one thing, `/<route>/<slug>`, and the old address of the card that once opened over a list instead,
 * `?kort=<kind>.<slug>`. A link to a thing is a link to its page (`pageHref`); the old address is still read
 * (`detailOf`) so the media server can send a bookmark of a card to the page (`pagePath`). The address can be edited by
 * anyone, so it is read back through a schema and a slug is only what a slug path accepts.
 */
import * as v from "valibot"

import { appUrl } from "./base-url.ts"

/** The search parameter that named the card. */
export const DETAIL_PARAM = "kort"

const DetailSchema = v.object({ kind: v.pipe(v.string(), v.regex(/^[a-z0-9-]+$/)), slug: v.pipe(v.string(), v.regex(/^[a-z0-9-]+$/)) })

export type Detail = v.InferOutput<typeof DetailSchema>

/** A kind whose page is under another word than its own: the shelf apps name their works in English and their pages in Norwegian. */
const ROUTES: Readonly<Record<string, string>> = { game: "spill", book: "bok", boardgame: "brettspill" }

/** The card an old address names, or none when it names no card or a malformed one. */
export function detailOf(search: string | URLSearchParams): Detail | undefined {
  const value = new URLSearchParams(search).get(DETAIL_PARAM)
  if (value === null) return undefined
  const [kind, slug, ...rest] = value.split(".")
  const parsed = v.safeParse(DetailSchema, { kind, slug })
  return parsed.success && rest.length === 0 ? parsed.output : undefined
}

/** The path of a thing's page inside its app: `/artist/orville-peck`, `/spill/hades`. */
export function pagePath({ kind, slug }: Detail): string {
  return `/${ROUTES[kind] ?? kind}/${slug}`
}

/** The address of a thing's page as the browser asks for it, under the app's base: the link in a list. */
export function pageHref(detail: Detail): string {
  return appUrl(pagePath(detail))
}
