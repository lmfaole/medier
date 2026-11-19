/**
 * An app's whole JSON API from its one endpoint, `pages/api/[...file].ts`: every
 * `/api/<name>.json` is a file of the snapshot in the asset store, which
 * `npm run snapshot` writes from the local databases before the build. A Worker has
 * no database, so the page asks the same address in development and in production.
 *
 * Reads only. Nothing an app serves writes to a table here, which is why there
 * is one handler and it is a `GET`; `app-shell/lib/api.ts` is the route that
 * wraps this. The `API` map of loaders is for the snapshot and for the page's types,
 * and is not imported here, so no SQL reaches the Worker.
 */

import { staticJsonFiles } from './static-json-files.ts'

/** One API file, built from the database and the request URL. */
export type ApiLoader = (db: D1Database, url: URL) => Promise<unknown>

/** An app's `API` map: one named loader per JSON file it serves. */
export type AppApi = Record<string, ApiLoader>

/** The bindings a read needs: the asset store, which holds the snapshot. */
export interface ApiEnv {
  ASSETS: Fetcher
}

/**
 * Each API file mapped to what its loader returns — the app's `ApiResponses`,
 * which `RESPONSES` of the app `satisfies`. Derived from the map itself, so the
 * page cannot name a file the Worker does not serve.
 */
export type ApiResponsesOf<Api extends AppApi> = {
  [File in keyof Api]: Awaited<ReturnType<Api[File]>>
}

export function apiFiles<Env extends ApiEnv>(
  env: () => Env,
  { cacheControl, assetBase }: { cacheControl?: string; assetBase?: string } = {},
): (args: { request: Request }) => Promise<Response> {
  return staticJsonFiles({
    assets: () => env().ASSETS,
    ...(cacheControl === undefined ? {} : { cacheControl }),
    ...(assetBase === undefined ? {} : { assetBase }),
  })
}
