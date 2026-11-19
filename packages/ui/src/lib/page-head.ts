import type { OgTagsOptions } from "@designsystem/config/og-tags"

import type { AnyAppId } from "./apps.ts"
import { BASE_URL } from "./base-url.ts"
import { pageOg } from "./og-pages.ts"

/** The path of a request inside the app (`/apps/film/toppliste` is `/toppliste`; the app's own root is `/`). */
export function appPathOf(url: URL, base: string = BASE_URL): string {
  const prefix = base.replace(/\/+$/, "")
  const path = prefix !== "" && (url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)) ? url.pathname.slice(prefix.length) : url.pathname
  return path === "" ? "/" : path
}

/** The document title and Open Graph tags of a page from its row in `og-pages.json`; `title` is for a page no row covers. */
export function pageHeadOf(app: AnyAppId, url: URL, title: string, base: string = BASE_URL): { title: string; og?: OgTagsOptions } {
  const page = pageOg(app, appPathOf(url, base))
  return page === undefined ? { title } : page
}
