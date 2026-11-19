/**
 * The reverse proxy of the media server: every path under `/apps/hjemmeserver/` that no mounted home app owns goes to Nextcloud
 * as it came (the old plain-JS pages, the Miniflux PHP proxy, an app's manifest and service worker, the share target). That is what
 * lets the Cloudflare tunnel hold one static rule for the whole prefix, so a new home app never needs a tunnel edit.
 *
 * It is a pipe, not a client: the method, the path and query, the headers (cookies included, `Host` set to Nextcloud's public name)
 * and the body go upstream as they come, and the status, the headers (`Set-Cookie`, `Location`, Nextcloud's own security headers)
 * and the body come back as they are, both streamed and never buffered. It does not follow redirects, does not decompress, does not
 * log anyone in and adds no header of ours: the login gate and the media CSP are for what this server serves itself.
 */

import { Agent, request as upstreamRequest, type IncomingHttpHeaders, type IncomingMessage, type RequestListener, type ServerResponse } from "node:http"
import { pipeline } from "node:stream"

/** The prefix whose unmounted paths belong to Nextcloud. */
export const PROXY_PREFIX = "/apps/hjemmeserver"

export const isProxiedPath = (pathname: string): boolean => pathname === PROXY_PREFIX || pathname.startsWith(`${PROXY_PREFIX}/`)

export interface ProxyOptions {
  /** Where Nextcloud answers on the container network (`http://nextcloud:80`). */
  upstream: string
  /** Its public name, sent as `Host`. */
  host: string
  /** Milliseconds of silence on the upstream socket (waiting for its answer or between chunks) before the request is given up with a 502. */
  timeoutMs?: number
  log?: (message: string) => void
}

const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"])

/** Whether a header stays on the way through: not hop-by-hop, and not named by the `Connection` header. */
function forwarder(connection: string | string[] | undefined): (name: string) => boolean {
  const named = new Set((Array.isArray(connection) ? connection.join(",") : (connection ?? "")).split(",").map((token) => token.trim().toLowerCase()))
  return (name) => !HOP_BY_HOP.has(name.toLowerCase()) && !named.has(name.toLowerCase())
}

/** The headers Nextcloud is sent: the visitor's, minus hop-by-hop, with the forwarding trail extended and `Host` replaced. */
function upstreamHeaders(incoming: IncomingMessage, host: string): IncomingHttpHeaders {
  const keep = forwarder(incoming.headers.connection)
  const headers: IncomingHttpHeaders = {}
  for (const [name, value] of Object.entries(incoming.headers)) if (value !== undefined && keep(name)) headers[name] = value
  const first = (name: string) => [incoming.headers[name]].flat()[0]
  const peer = incoming.socket.remoteAddress
  headers["x-forwarded-for"] = [first("x-forwarded-for"), peer].filter((one) => one !== undefined && one !== "").join(", ")
  headers["x-forwarded-proto"] = first("x-forwarded-proto") ?? "https"
  headers["x-forwarded-host"] = first("x-forwarded-host") ?? incoming.headers.host
  headers.host = host
  return headers
}

/** The status line's headers as Nextcloud sent them, duplicates kept, hop-by-hop dropped, as the flat list `writeHead` takes. */
function downstreamHeaders(upstream: IncomingMessage): string[] {
  const keep = forwarder(upstream.headers.connection)
  const flat: string[] = []
  for (let index = 0; index + 1 < upstream.rawHeaders.length; index += 2) {
    const name = upstream.rawHeaders[index] ?? ""
    if (keep(name)) flat.push(name, upstream.rawHeaders[index + 1] ?? "")
  }
  return flat
}

export function createProxy({ upstream, host, timeoutMs = 120_000, log = console.error }: ProxyOptions): RequestListener {
  const target = new URL(upstream)
  if (target.protocol !== "http:") throw new Error(`media-proxy: ${upstream} is not an http: address`)
  const agent = new Agent({ keepAlive: true })

  return (incoming, res: ServerResponse) => {
    const label = `${incoming.method} ${incoming.url}`
    const path = (() => {
      const url = new URL(incoming.url ?? "/", "http://proxy.invalid")
      return `${url.pathname}${url.search}`
    })()
    const outgoing = upstreamRequest(
      { agent, hostname: target.hostname, port: target.port === "" ? 80 : Number(target.port), method: incoming.method, path, headers: upstreamHeaders(incoming, host), timeout: timeoutMs },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.statusMessage, downstreamHeaders(answer))
        pipeline(answer, res, () => {})
      },
    )
    const failed = (error: Error) => {
      if (res.destroyed) return // the visitor left; nothing to answer
      log(`media-proxy: ${label}: ${error.message}`)
      if (res.headersSent) res.destroy()
      else res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }).end("Bad gateway\n")
    }
    outgoing.on("timeout", () => outgoing.destroy(new Error(`no answer from ${target.host} in ${timeoutMs} ms`)))
    outgoing.on("error", failed)
    // The visitor leaving ends the upstream request too.
    res.on("close", () => {
      if (!res.writableFinished) outgoing.destroy()
    })
    pipeline(incoming, outgoing, () => {})
  }
}
