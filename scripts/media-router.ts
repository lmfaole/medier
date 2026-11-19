/**
 * The request pipeline of the media server, in the order a Worker's was, for the eight apps mounted under their base paths:
 *
 * 1. `/healthz` answers without a login (the uptime check), and a path under `/apps/hjemmeserver/` that no mounted app holds is proxied to Nextcloud (`media-proxy.ts`), ahead of the gate;
 * 2. the login gate (`login-gate.ts`) is the first thing every other request meets;
 * 3. the app is found by its base (`/apps/film`), the longest that holds the path; the bare base goes to its slash, a base an app
 *    left is redirected to where it is now, and anything else outside every base is a 404;
 * 4. a page that moved is redirected, and so is the old address of a card over a list (`?kort=<kind>.<slug>`) to the page of the
 *    thing it named, `<base>/api/*` is answered by the app's in-process fetcher (ETag and 304),
 *    a file of the app's `dist/client` is served as it is, and the app's own extra route (music's covers) gets a go;
 * 5. everything else is a page, rendered by the app's Astro handler, loaded the first time it is needed.
 *
 * What it does not do: write anything but what an app's own `write` route does (music's push subscriptions), or trust a header the browser sent. Every answer carries the security headers and a
 * private cache rule, because it is the owner's.
 */

import type { IncomingMessage, RequestListener, ServerResponse } from "node:http"

import type { LoginGate } from "@designsystem/config/login-gate"
import { errorResponse } from "@designsystem/config/error-pages"
import { isImmutablePath, privateCacheControl, SECURITY_HEADERS } from "@designsystem/config/security-headers"
import { detailOf, pagePath } from "@designsystem/ui/lib/detail-state"

import { isProxiedPath } from "./media-proxy.ts"
import { sendResponse, shapeAstroResponse } from "./media-response.ts"
import { serveStatic } from "./media-static.ts"

/** The Node adapter's handler (`dist/server/entry.mjs`); `next` is called for a path no route of the app matches. */
export type AstroHandler = (request: IncomingMessage, response: ServerResponse, next: (error?: unknown) => void) => void | Promise<void>

export interface MountedApp {
  /** Without a trailing slash: `/apps/film`. */
  base: string
  moved: Readonly<Record<string, string>>
  /** The app's `dist/client`. */
  clientDirectory: string
  /** The pictures landed on the machine (`web/public/` of the app: covers, posters, artists), served when the build does not have one: the image is built without them. */
  pictureDirectory?: string
  /** `/api/*` of the app; the request is as received, base and all. */
  api: Fetcher
  /** Loads the app's build the first time a page is asked for. */
  handler(): Promise<AstroHandler>
  /** A route of the app's own for a path with no file: `path` is under the base. */
  extra?(path: URL): Promise<Response | undefined>
  /** A POST route of the app's own, the only kind of write the server has: `path` is under the base, the body is small. `undefined` is a 405. */
  write?(path: URL, request: Request): Promise<Response | undefined>
}

/** The largest body a POST may have: what an app's `write` routes ask for is a few hundred bytes. */
const MAX_POST_BYTES = 8192

export interface MediaRouterOptions {
  apps: readonly MountedApp[]
  /** A base an app left, mapped to its base now (`/apps/film` to `/apps/medier/film`): answered 301 with the rest of the path. */
  movedBases?: Readonly<Record<string, string>>
  /** A base of an app that left the server, mapped to where its page is now: answered 301 there, ahead of the app the path falls under. */
  retiredBases?: Readonly<Record<string, string>>
  /** Answers the paths under `/apps/hjemmeserver/` that no mounted app holds (Nextcloud's), before the gate and with no header of ours; without it they are a 404. */
  proxy?: RequestListener
  /** `undefined` lets everybody in: only for a development run on this machine. */
  gate: LoginGate | undefined
  headers?: Record<string, string>
  log?: (message: string) => void
}

const UPTIME_PATH = "/healthz"

function plain(status: number, text: string, headers: Record<string, string>, extra: Record<string, string> = {}): Response {
  const merged = new Headers(headers)
  merged.set("Content-Type", "text/plain; charset=utf-8")
  merged.set("Cache-Control", "no-store")
  for (const [name, value] of Object.entries(extra)) merged.set(name, value)
  return new Response(text, { status, headers: merged })
}

/** The request as the gate and the routes see it: the method, the address as received, the headers. */
function requestFrom(incoming: IncomingMessage): Request {
  const headers = new Headers()
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (value === undefined) continue
    for (const one of Array.isArray(value) ? value : [value]) headers.append(name, one)
  }
  // Only the path and the headers matter to what follows; the host is whatever the proxy forwarded.
  return new Request(new URL(incoming.url ?? "/", `http://${incoming.headers.host ?? "localhost"}`), { method: incoming.method ?? "GET", headers })
}

/** The app whose base holds `pathname`, the path inside it, or the reason there is none. `apps` is longest base first: the hub's base holds every other. */
function mounted(apps: readonly MountedApp[], pathname: string): { app: MountedApp; inside: string } | "bare" | undefined {
  for (const app of apps) {
    if (pathname === app.base) return "bare"
    if (pathname.startsWith(`${app.base}/`)) return { app, inside: pathname.slice(app.base.length) }
  }
  return undefined
}

export function createMediaRouter({ apps: mountedApps, movedBases = {}, retiredBases = {}, proxy, gate, headers = SECURITY_HEADERS, log = console.error }: MediaRouterOptions): RequestListener {
  const apps = mountedApps.toSorted((a, b) => b.base.length - a.base.length)

  function privately(response: Response): Response {
    const merged = new Headers(response.headers)
    for (const [name, value] of Object.entries(headers)) merged.set(name, value)
    merged.set("Cache-Control", privateCacheControl(merged.get("Cache-Control") ?? "no-store"))
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: merged })
  }

  /** Everything but a page rendered by Astro: the answer is a `Response`, or `"astro"` when a page is wanted. */
  async function route(request: Request, url: URL): Promise<Response | { render: MountedApp }> {
    const retired = Object.keys(retiredBases).find((base) => url.pathname === base || url.pathname.startsWith(`${base}/`))
    if (retired !== undefined) return new Response(null, { status: 301, headers: { Location: retiredBases[retired] ?? "/" } })
    const found = mounted(apps, url.pathname)
    if (found === undefined) {
      const left = Object.keys(movedBases).find((base) => url.pathname === base || url.pathname.startsWith(`${base}/`))
      if (left !== undefined) return new Response(null, { status: 301, headers: { Location: `${movedBases[left]}${url.pathname.slice(left.length) || "/"}${url.search}` } })
      return plain(404, "Not found\n", headers)
    }
    // A relative address, so it holds whatever host the proxy forwards.
    if (found === "bare") {
      const base = apps.find((app) => app.base === url.pathname)?.base ?? url.pathname
      return new Response(null, { status: 308, headers: { Location: `${base}/${url.search}`, "Cache-Control": "no-store" } })
    }
    const { app, inside } = found

    const movedTo = app.moved[inside.replace(/\/$/, "")]
    if (movedTo !== undefined) return new Response(null, { status: 301, headers: { Location: `${app.base}${movedTo}${url.search}` } })
    const card = detailOf(url.searchParams)
    if (card !== undefined && !inside.startsWith("/api/")) return new Response(null, { status: 301, headers: { Location: `${app.base}${pagePath(card)}` } })

    if (inside.startsWith("/api/")) return app.api.fetch(request)

    const file = (await serveStatic(app.clientDirectory, inside, request)) ?? (app.pictureDirectory === undefined ? null : await serveStatic(app.pictureDirectory, inside, request))
    if (file !== null) return file
    const extra = await app.extra?.(new URL(`${inside}${url.search}`, url))
    if (extra !== undefined) return extra
    // A hashed or immutable path that is not built is a missing file, never a page under a year-long cache rule.
    if (isImmutablePath(inside)) return plain(404, "Not found\n", headers)
    return { render: app }
  }

  /** A POST: the app's `write` route with the body read (up to `MAX_POST_BYTES`), else a 405. */
  async function post(incoming: IncomingMessage, request: Request, url: URL): Promise<Response> {
    const found = mounted(apps, url.pathname)
    const write = found === undefined || found === "bare" ? undefined : found.app.write
    if (found === undefined || found === "bare" || write === undefined) return plain(405, "Method not allowed\n", headers, { Allow: "GET, HEAD" })
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of incoming) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      size += bytes.length
      if (size > MAX_POST_BYTES) return plain(413, "Too large\n", headers)
      chunks.push(bytes)
    }
    const body = new Request(request.url, { method: "POST", headers: request.headers, body: Buffer.concat(chunks) })
    const answer = await write(new URL(`${found.inside}${url.search}`, url), body)
    return answer ?? plain(405, "Method not allowed\n", headers, { Allow: "GET, HEAD" })
  }

  return async (incoming, res) => {
    const request = requestFrom(incoming)
    const url = new URL(request.url)
    const head = request.method === "HEAD"
    try {
      if (url.pathname === UPTIME_PATH) return await sendResponse(res, plain(200, "ok", headers), head)

      // Nextcloud's own login and redirects handle these; a mounted app's paths, bare base included, stay ours.
      if (proxy !== undefined && isProxiedPath(url.pathname) && mounted(apps, url.pathname) === undefined) return proxy(incoming, res)

      const refused = await gate?.check(request, request, headers)
      if (refused !== undefined) return await sendResponse(res, refused, head)

      if (request.method === "POST") return await sendResponse(res, privately(await post(incoming, request, url)), false)
      if (request.method !== "GET" && !head) return await sendResponse(res, plain(405, "Method not allowed\n", headers, { Allow: "GET, HEAD" }))

      const answer = await route(request, url)
      if (answer instanceof Response) return await sendResponse(res, privately(answer), head)

      const handler = await answer.render.handler()
      shapeAstroResponse(res, headers)
      await handler(incoming, res, () => {
        void sendResponse(res, privately(errorResponse(request, 404, headers)), head)
      })
    } catch (error) {
      log(`${request.method} ${url.pathname}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
      if (res.headersSent) res.destroy()
      else await sendResponse(res, privately(errorResponse(request, 500, headers)), head)
    }
  }
}
