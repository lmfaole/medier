/**
 * An app's reads, which is all an app does to the data in this repository.
 *
 * Reading is the whole contract. A page asks its own Worker for
 * `/api/<file>.json`; the Worker answers from the snapshot in its asset store,
 * in development and in production alike. Nothing an app serves writes to a
 * table here — a write goes to someone else's API. So an app's route has one
 * handler, it is a `GET`, and a new app adds nothing to any `db/<domain>.sql`.
 *
 * Deliberately not re-exported from an index: it reaches `cloudflare:workers`
 * through `cloudflareEnv`, which resolves only inside a Worker, while the app's
 * own `server/api.ts` has to stay loadable by `scripts/snapshot.ts`. The types
 * those two need are in `@designsystem/config/api-files` for that reason.
 */

import { apiFiles, type ApiEnv } from '../../api-files.ts'
import { withoutBasePath } from '../../base-path.ts'
import { cloudflareEnv } from '../../cloudflare-env.ts'

export interface AppApiHandlerOptions {
  /** A 200's `Cache-Control`; the API rule unless the answer should be kept differently. */
  cacheControl?: string
}

/**
 * The `GET` behind every `/api/<file>.json` an app serves, called from the
 * app's one endpoint `pages/api/[...file].ts`:
 *
 * ```ts
 * const handler = appApiHandler<MusicEnv>()
 * export const GET: APIRoute = ({ request }) => handler({ request })
 * ```
 *
 * The bindings are read through a thunk because an endpoint has none until a
 * request arrives.
 */
export function appApiHandler<Env extends ApiEnv = ApiEnv>({ cacheControl }: AppApiHandlerOptions = {}) {
  const env = () => cloudflareEnv<Env>()
  // Astro's asset store keeps the app's base in its paths, in dev and built alike (`dist/client/apps/rss/api/…`).
  const base = import.meta.env?.BASE_URL ?? '/'
  const read = apiFiles(env, { assetBase: base.replace(/\/$/, ''), ...(cacheControl === undefined ? {} : { cacheControl }) })
  // Astro matches the endpoint with the base on the path; the file name rules (`snapshotPath`) want it without.
  return ({ request }: { request: Request }) => read({ request: withoutBasePath(request, base) })
}
