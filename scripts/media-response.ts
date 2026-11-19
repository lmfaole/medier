/**
 * Getting responses between the Web `Response` the pipeline works with and Node's `ServerResponse`.
 *
 * `sendResponse` writes a `Response` to the socket. `shapeAstroResponse` is the other way: the Node adapter's handler writes
 * straight to the `ServerResponse`, so what a Worker does to Astro's answer afterwards (the security headers, the private
 * cache rule, the CSP hash of every inline script of a page) is done on the way out by wrapping that one response's
 * `writeHead`/`write`/`end`. Only an HTML page is held back (it is read whole to be hashed, as `withInlineScriptHashes` does).
 */

import type { OutgoingHttpHeaders, ServerResponse } from "node:http"
import { once } from "node:events"

import { withInlineScriptHashes } from "@designsystem/config/inline-script-hashes"
import { CACHE_STANDARD, privateCacheControl } from "@designsystem/config/security-headers"

export async function sendResponse(res: ServerResponse, response: Response, head = false): Promise<void> {
  const headers: OutgoingHttpHeaders = {}
  for (const [name, value] of response.headers) if (name !== "set-cookie") headers[name] = value
  const cookies = response.headers.getSetCookie()
  if (cookies.length > 0) headers["set-cookie"] = cookies
  res.writeHead(response.status, response.statusText === "" ? undefined : response.statusText, headers)
  if (head || response.body === null) {
    res.end()
    await response.body?.cancel()
    return
  }
  const reader = response.body.getReader()
  res.on("close", () => void reader.cancel().catch(() => {}))
  try {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      if (!res.write(chunk.value)) await once(res, "drain")
    }
    res.end()
  } catch {
    res.destroy()
  }
}

function headersOf(outgoing: OutgoingHttpHeaders | undefined): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(outgoing ?? {})) {
    if (value === undefined) continue
    for (const one of Array.isArray(value) ? value : [value]) headers.append(name, String(one))
  }
  return headers
}

/** The headers a Worker's `createAstroWorker` put on a page: the security headers over Astro's, and the cache rule made private. */
function shapeHeaders(headers: Headers, security: Readonly<Record<string, string>>): Headers {
  for (const [name, value] of Object.entries(security)) headers.set(name, value)
  headers.set("Cache-Control", privateCacheControl(headers.get("Cache-Control") ?? CACHE_STANDARD))
  return headers
}

/** `res` as Astro's handler will write it: patched, once, for this request only. */
export function shapeAstroResponse(res: ServerResponse, security: Readonly<Record<string, string>>): void {
  const writeHead = res.writeHead.bind(res)
  const write = res.write.bind(res)
  const end = res.end.bind(res)
  let held: { status: number; headers: Headers; chunks: Buffer[] } | undefined

  // The adapter calls `writeHead(status, headers)`, `write(bytes)` and `end()`; nothing else is used of them.
  Object.assign(res, {
    writeHead(status: number, outgoing?: OutgoingHttpHeaders): ServerResponse {
      const headers = shapeHeaders(headersOf(outgoing), security)
      if ((headers.get("Content-Type") ?? "").startsWith("text/html")) {
        held = { status, headers, chunks: [] }
        return res
      }
      const cookies = headers.getSetCookie()
      const shaped: OutgoingHttpHeaders = Object.fromEntries([...headers].filter(([name]) => name !== "set-cookie"))
      if (cookies.length > 0) shaped["set-cookie"] = cookies
      return writeHead(status, shaped)
    },
    write(...args: unknown[]): unknown {
      const [chunk] = args
      if (held === undefined || !(typeof chunk === "string" || chunk instanceof Uint8Array)) return Reflect.apply(write, res, args)
      held.chunks.push(Buffer.from(chunk))
      return true
    },
    end(...args: unknown[]): ServerResponse {
      if (held === undefined) return Reflect.apply(end, res, args)
      const page = held
      held = undefined
      // `end(chunk)` is `write(chunk)` and `end()`.
      if (typeof args[0] === "string" || args[0] instanceof Uint8Array) page.chunks.push(Buffer.from(args[0]))
      const body = Buffer.concat(page.chunks)
      // The page's own scripts are allowed by hash, as the Worker allowed them.
      withInlineScriptHashes(new Response(body, { status: page.status, headers: page.headers })).then(
        async (hashed) => {
          const bytes = Buffer.from(await hashed.arrayBuffer())
          const headers: OutgoingHttpHeaders = Object.fromEntries([...hashed.headers].filter(([name]) => name !== "set-cookie" && name !== "content-length"))
          const cookies = hashed.headers.getSetCookie()
          if (cookies.length > 0) headers["set-cookie"] = cookies
          headers["content-length"] = bytes.byteLength
          writeHead(page.status, headers)
          end(bytes)
        },
        (error: unknown) => res.destroy(error instanceof Error ? error : new Error(String(error))),
      )
      return res
    },
  })
}
