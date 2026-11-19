/**
 * Mounting a Worker under a path, as `sky.lmfaole.party/apps/musikk` is: a request for `/apps/musikk/x` is
 * handled as `/x`, so the asset store (whose files sit at the root of the build), the API routes and
 * every cache rule see the paths they would at a domain root. Astro is the exception, because it
 * works out its own base from `base` and wants the URL as received: `originalRequest` gives
 * it back. The page's links carry the prefix because the build adds it.
 */

import type { WorkerEnv, WorkerHandler } from './worker-app.ts'

/** `request` with the app's base cut off its path, for code that matches paths as if the app sat at a domain root. */
export function withoutBasePath(request: Request, basePath: string): Request {
  const prefix = basePath.replace(/\/+$/, '')
  const url = new URL(request.url)
  if (prefix === '' || !url.pathname.startsWith(`${prefix}/`)) return request
  url.pathname = url.pathname.slice(prefix.length)
  return new Request(url, request)
}

const received = new WeakMap<Request, Request>()

/** The request as the Worker was called with it, prefix and all; the request itself when it was never rewritten. */
export function originalRequest(request: Request): Request {
  return received.get(request) ?? request
}

/**
 * `basePath` is Vite's `base` (`/apps/musikk/`); the root, or nothing, leaves the app as it is. The bare
 * prefix goes to its slash; anything else outside it is a 404.
 */
export function withBasePath<Env extends WorkerEnv>(app: WorkerHandler<Env>, basePath: string): WorkerHandler<Env> {
  const prefix = basePath.replace(/\/+$/, '')
  if (prefix === '') return app
  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url)
      if (url.pathname === prefix) return Response.redirect(`${url.origin}${prefix}/${url.search}`, 308)
      if (!url.pathname.startsWith(`${prefix}/`)) return new Response('Not found\n', { status: 404, headers: { 'Cache-Control': 'no-store' } })
      url.pathname = url.pathname.slice(prefix.length)
      const stripped = new Request(url, request)
      received.set(stripped, request)
      return app.fetch(stripped, env, ctx)
    },
  }
}
