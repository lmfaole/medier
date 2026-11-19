/**
 * What an Astro app's Worker (`createAstroWorker`) takes besides its handler, and the
 * redirect of a page that has a new address. Kept apart from `astro-worker.ts` so its tests do not load Astro.
 */
import { originalRequest } from './base-path.ts'
import type { RouteContext, RouteHandler, WorkerEnv } from './worker-app.ts'

export interface MountedWorkerOptions<Env extends WorkerEnv> {
  /** Path prefixes the Worker answers itself, tried before the framework's. */
  prefixRoutes?: Record<string, RouteHandler<Env>>
  /** Replaces the shared security headers, e.g. `withFrameSource` for an app that embeds one page. */
  headers?: Record<string, string>
  /** The crawlers refused with 403; see `createWorkerApp`. */
  blockedCrawlers?: readonly string[]
  /** Behind the Nextcloud login, owner only (`login-gate.ts`): the media apps. Left out for the public `forside` and `work`. */
  requireLogin?: boolean
  /** Where the app is mounted. Defaults to the build's `base`, so an app says it once, in its own config. */
  basePath?: string
  /** The asset store keeps the base in its paths: the dev server does, a built `dist/client` does not. Defaults to `IS_DEV`. */
  assetsUnderBase?: boolean
  /** Pages that have a new address (`moved-pages.ts`): a path under the base mapped to the new one, answered with a redirect. */
  moved?: Readonly<Record<string, string>>
}

/** The redirect for a page that moved, or `undefined` for any other path. `base` has no trailing slash. */
export function movedPageResponse<Env extends WorkerEnv>(moved: Readonly<Record<string, string>>, context: RouteContext<Env>, base: string): Response | undefined {
  const movedTo = moved[context.url.pathname.replace(/\/$/, '')]
  if (movedTo === undefined) return undefined
  const asked = new URL(originalRequest(context.request).url)
  return new Response(null, { status: 301, headers: { Location: `${base}${movedTo}${asked.search}` } })
}
