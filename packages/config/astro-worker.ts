/**
 * The Worker for an app built with Astro, which renders its pages on the server per request:
 * the shared pipeline of `createWorkerApp` first, so the crawler block runs before Astro does, then
 *
 * - `/api/*` (the snapshot endpoint) to Astro, with the security headers added;
 * - a file the asset store has (hashed scripts, images, `robots.txt`) from the store;
 * - everything else, every page, to Astro, which reads its data from the snapshot in the asset store.
 *
 * A server island (`/_server-islands/<Name>`, `astro-worker.test.ts`) needs no route of its own: it is "everything else", so it
 * passes the base path, the crawler block and the security headers like a page, and its inline loader script is allowed by hash.
 */
import { originalRequest, withBasePath } from './base-path.ts'
import { loginGateFor } from './login-gate.ts'
import { withInlineScriptHashes } from './inline-script-hashes.ts'
import { cacheControlFor, isImmutablePath } from './security-headers.ts'
import { movedPageResponse, type MountedWorkerOptions } from './mounted-worker.ts'
import { createWorkerApp, type RouteContext, type WorkerEnv, type WorkerHandler } from './worker-app.ts'

const API_PREFIX = '/api/'

/** Astro's answer to a request as received; `astro-render.ts` is the one that calls Astro, so a test can stand in for it. */
export type AstroRender<Env extends WorkerEnv> = (request: Request, env: Env, ctx: ExecutionContext | undefined, kind: { api: boolean }) => Promise<Response>

export function createAstroWorker<Env extends WorkerEnv>({
  render,
  prefixRoutes = {},
  headers: securityHeaders,
  blockedCrawlers,
  requireLogin = false,
  basePath = import.meta.env?.BASE_URL ?? '/',
  // Astro puts the build's client files under the base, in dev and built alike, so a mounted app's asset paths keep it.
  assetsUnderBase = true,
  moved = {},
}: MountedWorkerOptions<Env> & { render: AstroRender<Env> }): WorkerHandler<Env> {
  const base = basePath.replace(/\/$/, '')

  async function toAstro({ request, url, headers, env, ctx }: RouteContext<Env>): Promise<Response> {
    // Astro works out its own base and wants the URL as received.
    const response = await render(originalRequest(request), env, ctx, { api: url.pathname.startsWith(API_PREFIX) })
    const merged = new Headers(response.headers)
    for (const [name, value] of Object.entries(headers)) merged.set(name, value)
    // A snapshot file the asset store answers itself comes with the store's revalidate rule, not the API's.
    if (!response.headers.has('Cache-Control') || (response.ok && url.pathname.startsWith(API_PREFIX))) merged.set('Cache-Control', cacheControlFor(url.pathname))
    const answer = new Response(response.body, { status: response.status, statusText: response.statusText, headers: merged })
    // Astro's island scripts are inline and the header's `script-src 'self'` blocks them (a `<meta>` policy only adds to it,
    // never lifts it), so each page's own are allowed by hash. What the API answers is never HTML to run.
    return url.pathname.startsWith(API_PREFIX) ? answer : withInlineScriptHashes(answer)
  }

  async function assetsOrAstro(context: RouteContext<Env>): Promise<Response> {
    const redirect = movedPageResponse(moved, context, base)
    if (redirect !== undefined) return redirect
    const response = await context.assets(assetsUnderBase ? originalRequest(context.request) : context.request)
    // An immutable path is never "not built yet": handing it to Astro would answer with a page under a year-long cache rule.
    if (response.status === 404 && !isImmutablePath(context.url.pathname)) return toAstro(context)
    return withInlineScriptHashes(response)
  }

  const app = createWorkerApp<Env>({
    ...(securityHeaders === undefined ? {} : { headers: securityHeaders }),
    ...(blockedCrawlers === undefined ? {} : { blockedCrawlers }),
    gate: loginGateFor(requireLogin),
    prefixRoutes: { ...prefixRoutes, [API_PREFIX]: toAstro },
    fallback: assetsOrAstro,
  })
  return withBasePath(app, basePath)
}
