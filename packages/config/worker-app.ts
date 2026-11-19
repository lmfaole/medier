/**
 * The request pipeline every app's Worker shares, so each `worker.ts` is
 * only its own routes:
 *
 * 1. a listed crawler gets 403 before anything else runs;
 * 2. the uptime path;
 * 3. the login gate, when the app has one (`login-gate.ts`); what it lets through is made private to the browser;
 * 4. the app's routes, by path prefix, in the order given;
 * 5. everything else from `fallback`; `context.assets()` is the asset store
 *    with security headers and the cache rule for its path.
 *
 * An exception anywhere becomes the shared 500 page.
 */

import { jsonResponse } from './json-response.ts'
import { IS_DEV } from './dev-flag.ts'
import { originalRequest } from './base-path.ts'
import { withServerErrorPage } from './error-pages.ts'
import type { LoginGate } from './login-gate.ts'
import { BLOCKED_CRAWLERS, CACHE_STANDARD, DEV_SECURITY_HEADERS, SECURITY_HEADERS, cacheControlFor, isImmutablePath, privateCacheControl } from './security-headers.ts'

/** The path an uptime check asks, to see that the app answers. */
const UPTIME_PATH = '/healthz'

export interface WorkerEnv {
  ASSETS: Fetcher
}

export interface RouteContext<Env extends WorkerEnv> {
  request: Request
  env: Env
  ctx: ExecutionContext | undefined
  url: URL
  /** The headers every response carries. */
  headers: Record<string, string>
  /** JSON with the security headers and the API cache rule. */
  json(data: unknown, status?: number): Response
  /** The asset store's answer for this request (or `assetRequest`), with security headers and its path's cache rule. */
  assets(assetRequest?: Request): Promise<Response>
}

export type RouteHandler<Env extends WorkerEnv> = (context: RouteContext<Env>) => Promise<Response> | Response

/** What a Worker module exports as its default: `fetch` is all these apps use. */
export interface WorkerHandler<Env extends WorkerEnv> {
  fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response>
}

export function createWorkerApp<Env extends WorkerEnv>({
  prefixRoutes = {},
  headers = IS_DEV ? DEV_SECURITY_HEADERS : SECURITY_HEADERS,
  blockedCrawlers = BLOCKED_CRAWLERS,
  gate,
  fallback,
}: {
  /** Path prefixes, e.g. `'/covers/'`, tried in order. */
  prefixRoutes?: Record<string, RouteHandler<Env>>
  /** Defaults to `SECURITY_HEADERS`, or `DEV_SECURITY_HEADERS` under `vite dev`. */
  headers?: Record<string, string>
  /** The crawlers refused with 403; all of `BLOCKED_CRAWLERS` unless the app wants search engines in. */
  blockedCrawlers?: readonly string[]
  /** Only the logged-in owner is let in; see `login-gate.ts`. */
  gate?: LoginGate | undefined
  /** A path no route owns. */
  fallback: RouteHandler<Env>
}): WorkerHandler<Env> {
  const prefixes = Object.entries(prefixRoutes)

  async function handleRequest(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    const userAgent = (request.headers.get('user-agent') ?? '').toLowerCase()
    if (blockedCrawlers.some((bot) => userAgent.includes(bot.toLowerCase()))) {
      return textResponse('Forbidden\n', 403, headers, CACHE_STANDARD)
    }

    if (url.pathname === UPTIME_PATH) return textResponse('ok', 200, headers, 'no-store')

    const refused = await gate?.check(request, originalRequest(request), headers)
    if (refused !== undefined) return refused

    const context = createContext(request, env, ctx, url, headers)
    const route = prefixes.find(([prefix]) => url.pathname.startsWith(prefix))?.[1]
    const response = await (route ?? fallback)(context)
    return gate === undefined ? response : withPrivateCache(response)
  }

  return { fetch: withServerErrorPage(handleRequest, headers) }
}

function createContext<Env extends WorkerEnv>(
  request: Request,
  env: Env,
  ctx: ExecutionContext | undefined,
  url: URL,
  headers: Record<string, string>,
): RouteContext<Env> {
  async function assets(assetRequest: Request = request): Promise<Response> {
    const response = await env.ASSETS.fetch(assetRequest)
    // Two ways an immutable path can come back as something it is not, both of
    // which the immutable rule must never be applied to: the store's SPA
    // fallback answering a missing file with the shell's HTML, and the store's
    // own 404. Either way a year-long cached answer would outlive the fix.
    const contentType = response.headers.get('Content-Type') ?? ''
    if (isImmutablePath(url.pathname) && (response.status === 404 || contentType.startsWith('text/html'))) {
      await response.body?.cancel()
      return textResponse('Not found\n', 404, headers, 'no-store')
    }
    const merged = new Headers(response.headers)
    for (const [name, value] of Object.entries(headers)) merged.set(name, value)
    merged.set('Cache-Control', cacheControlFor(url.pathname))
    return new Response(response.body, { status: response.status, headers: merged })
  }

  return {
    request,
    env,
    ctx,
    url,
    headers,
    json: (data: unknown, status?: number) => jsonResponse(data, headers, status),
    assets,
  }
}

function textResponse(body: string, status: number, headers: Record<string, string>, cacheControl: string): Response {
  const merged = new Headers(headers)
  merged.set('Content-Type', 'text/plain; charset=utf-8')
  merged.set('Cache-Control', cacheControl)
  return new Response(body, { status, headers: merged })
}

/** The page edge cache (`Cloudflare-CDN-Cache-Control`) would hand the owner's page to the next visitor, so it goes too. */
function withPrivateCache(response: Response): Response {
  const merged = new Headers(response.headers)
  merged.set('Cache-Control', privateCacheControl(merged.get('Cache-Control') ?? 'no-store'))
  merged.delete('Cloudflare-CDN-Cache-Control')
  merged.delete('CDN-Cache-Control')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: merged })
}
