/**
 * How an Astro page reads an API file while it renders: the same snapshot in the asset store that
 * `/api/<file>.json` serves, with no request to the Worker itself. Only a Worker can load this, because it
 * reaches `cloudflare:workers` through `cloudflareEnv`.
 *
 * Why a valibot schema per file and not an Astro live collection (both were built for forside and served under the adapter
 * with no binding): a live collection takes zod (`astro/zod`), a second schema language beside the valibot every boundary here
 * uses, and its schema is not tied to the loaders' `ApiResponses`; it needs `astro:content`, which no unit test loads; and each
 * file becomes a collection of one entry. The valibot schema `satisfies` `ApiResponses` (forside's `server/responses.ts`),
 * types the page through `readApi`, and `readSnapshot` is tested against a fake asset store.
 */
import type * as v from 'valibot'

import { errorPageHtml } from './error-pages.ts'
import { cloudflareEnv } from './cloudflare-env.ts'
import { readSnapshot } from './snapshot-read.ts'
import type { ApiEnv } from './api-files.ts'

/** `url` is the page's own, for its origin and, under `vite dev`, its base. */
export function readApi<TSchema extends v.GenericSchema>(url: URL, file: string, schema: TSchema, params: Record<string, string> = {}): Promise<v.InferOutput<TSchema>> {
  // Astro's build nests `dist/client` under the app's base (`dist/client/apps/music/api/…`) just as the dev server does.
  const assetBase = (import.meta.env?.BASE_URL ?? '/').replace(/\/$/, '')
  return readSnapshot({ assets: () => cloudflareEnv<ApiEnv>().ASSETS, assetBase }, url.origin, file, schema, params)
}

/** `readApi` for the file and parameters a standard page asks for (`@designsystem/ui/lib/page-requests`). */
export function readPage<TSchema extends v.GenericSchema>(url: URL, request: { file: string; params: Record<string, string> }, schema: TSchema): Promise<v.InferOutput<TSchema>> {
  return readApi(url, request.file, schema, request.params)
}

/** The shared 404 page, for a page whose address names a period or a thing the snapshot has no file for. */
export function notFoundPage(): Response {
  return new Response(errorPageHtml(404), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
