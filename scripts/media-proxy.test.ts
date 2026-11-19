import { strict as assert } from "node:assert"
import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http"
import { afterEach, beforeEach, test } from "node:test"

import type { LoginGate } from "@designsystem/config/login-gate"

import { createMediaRouter, type MountedApp } from "./media-router.ts"
import { createProxy } from "./media-proxy.ts"

interface Seen {
  method: string | undefined
  url: string | undefined
  headers: IncomingHttpHeaders
  body: string
}

let upstream: Server
let front: Server
let upstreamPort = 0
let frontPort = 0
let seen: Seen[] = []
let logged: string[] = []
const gateChecked: string[] = []

const listen = (server: Server) =>
  new Promise<number>((done) =>
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      done(address !== null && typeof address === "object" ? address.port : 0)
    }),
  )
const closeAll = (server: Server) => new Promise((done) => (server.closeAllConnections(), server.close(done)))

const gate: LoginGate = {
  verdictKeys: () => [],
  async check(incoming) {
    gateChecked.push(new URL(incoming.url).pathname)
    return new Response("", { status: 302, headers: { Location: "https://login.test/" } })
  },
}

const penger: MountedApp = {
  base: "/apps/hjemmeserver/penger",
  moved: {},
  clientDirectory: "/nonexistent",
  api: { fetch: async () => Response.json({ own: true }) },
  handler: async () => (_request, response) => void response.end("penger page"),
}

/** The router in front of a fake Nextcloud (`down`: one that has been closed again). */
async function start(handlerOf: () => Parameters<typeof createServer>[1], down = false): Promise<void> {
  upstream = createServer(handlerOf())
  upstreamPort = await listen(upstream)
  if (down) await closeAll(upstream)
  const proxy = createProxy({ upstream: `http://127.0.0.1:${upstreamPort}`, host: "sky.test", timeoutMs: 400, log: (line) => logged.push(line) })
  front = createServer(createMediaRouter({ apps: [penger], gate, proxy, log: (line) => logged.push(line) }))
  frontPort = await listen(front)
}

beforeEach(() => {
  seen = []
  logged = []
  gateChecked.length = 0
})
afterEach(async () => {
  await closeAll(front)
  if (upstream.listening) await closeAll(upstream)
})

/** The fake Nextcloud: records the request, answers by the path. */
const nextcloud = (): Parameters<typeof createServer>[1] => async (req, res) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() })
  if (req.url?.startsWith("/apps/hjemmeserver/redirect")) res.writeHead(302, { Location: "https://sky.test/index.php/login?redirect_url=%2Fapps%2Fhjemmeserver%2F" }).end()
  else if (req.url?.startsWith("/apps/hjemmeserver/cookies"))
    res.writeHead(200, { "Set-Cookie": ["a=1; Path=/; HttpOnly", "b=2; Path=/; SameSite=Lax"], "Content-Security-Policy": "default-src 'self'", "X-Custom": "yes", Connection: "close, x-secret", "X-Secret": "hidden", "Keep-Alive": "timeout=77" }).end("ok")
  else if (req.url?.startsWith("/apps/hjemmeserver/slow")) setTimeout(() => res.end("late"), 3000).unref()
  else if (req.url?.startsWith("/apps/hjemmeserver/stream")) {
    res.writeHead(200)
    res.write("first")
    setTimeout(() => res.end("second"), 100)
  } else res.writeHead(200, { "Content-Type": "text/plain" }).end(`${req.method} ${req.url}`)
}

function ask(path: string, init: { method?: string; headers?: Record<string, string>; body?: string | Buffer } = {}): Promise<{ status: number; headers: IncomingHttpHeaders; rawHeaders: string[]; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: frontPort, path, method: init.method ?? "GET", headers: { Host: "sky.lmfaole.party", ...init.headers } }, (res) => {
      const chunks: Buffer[] = []
      res.on("data", (chunk: Buffer) => chunks.push(chunk))
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, rawHeaders: res.rawHeaders, body: Buffer.concat(chunks).toString() }))
    })
    req.on("error", reject)
    req.end(init.body)
  })
}

test("any method goes through with its path and query, and no login is asked for", async () => {
  await start(nextcloud)
  for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "PROPFIND"]) {
    const answer = await ask("/apps/hjemmeserver/oversikt/index.html?x=1&y=%C3%A5", { method })
    assert.equal(answer.status, 200, method)
    assert.equal(answer.body, `${method} /apps/hjemmeserver/oversikt/index.html?x=1&y=%C3%A5`)
  }
  assert.deepEqual(gateChecked, [])
  const head = await ask("/apps/hjemmeserver/oversikt/", { method: "HEAD" })
  assert.equal(head.status, 200)
  assert.equal(head.body, "")
})

test("the request body arrives whole, even when large, and a chunked one too", async () => {
  await start(nextcloud)
  const big = Buffer.alloc(5 * 1024 * 1024, "x")
  await ask("/apps/hjemmeserver/api/upload", { method: "PUT", body: big })
  assert.equal(seen[0]?.body.length, big.length)
  assert.equal(seen[0]?.headers["content-length"], String(big.length))

  await new Promise<void>((done, fail) => {
    const req = request({ host: "127.0.0.1", port: frontPort, path: "/apps/hjemmeserver/api/chunked", method: "POST" }, (res) => void res.resume().on("end", done))
    req.on("error", fail)
    req.write("one,")
    setTimeout(() => req.end("two"), 50)
  })
  assert.equal(seen[1]?.body, "one,two")
  assert.equal(seen[1]?.headers["transfer-encoding"], "chunked")
})

test("the response body is streamed: the first chunk is there before the upstream has ended", async () => {
  await start(nextcloud)
  const first = await new Promise<number>((done) => {
    const started = Date.now()
    request({ host: "127.0.0.1", port: frontPort, path: "/apps/hjemmeserver/stream" }, (res) => {
      res.once("data", () => done(Date.now() - started))
      res.resume()
    }).end()
  })
  assert.ok(first < 90, `first chunk after ${first} ms`)
})

test("Host is Nextcloud's public name; cookies and the forwarding trail go upstream, hop-by-hop headers do not", async () => {
  await start(nextcloud)
  await ask("/apps/hjemmeserver/oversikt/", {
    headers: { Cookie: "nc_session_id=abc; oc_sessionPassphrase=def", "Cf-Connecting-Ip": "203.0.113.9", "X-Forwarded-For": "203.0.113.9", "X-Forwarded-Proto": "https", Connection: "keep-alive, x-private", "X-Private": "no", "Keep-Alive": "timeout=5", TE: "trailers", Authorization: "Bearer t" },
  })
  const headers = seen[0]?.headers ?? {}
  assert.equal(headers.host, "sky.test")
  assert.equal(headers.cookie, "nc_session_id=abc; oc_sessionPassphrase=def")
  assert.equal(headers["cf-connecting-ip"], "203.0.113.9")
  assert.equal(headers.authorization, "Bearer t")
  assert.equal(headers["x-forwarded-for"], "203.0.113.9, 127.0.0.1")
  assert.equal(headers["x-forwarded-proto"], "https")
  assert.equal(headers["x-forwarded-host"], "sky.lmfaole.party")
  assert.equal(headers["x-private"], undefined)
  assert.equal(headers["keep-alive"], undefined)
  assert.equal(headers.te, undefined)
})

test("without a forwarding trail one is started, for https and the public host", async () => {
  await start(nextcloud)
  await ask("/apps/hjemmeserver/oversikt/")
  assert.equal(seen[0]?.headers["x-forwarded-for"], "127.0.0.1")
  assert.equal(seen[0]?.headers["x-forwarded-proto"], "https")
})

test("Set-Cookie (each one), Nextcloud's own security headers and custom headers come back unchanged; hop-by-hop ones do not", async () => {
  await start(nextcloud)
  const answer = await ask("/apps/hjemmeserver/cookies")
  assert.deepEqual(answer.headers["set-cookie"], ["a=1; Path=/; HttpOnly", "b=2; Path=/; SameSite=Lax"])
  assert.equal(answer.headers["content-security-policy"], "default-src 'self'")
  assert.equal(answer.headers["x-custom"], "yes")
  assert.equal(answer.headers["x-secret"], undefined)
  assert.notEqual(answer.headers["keep-alive"], "timeout=77")
  // Nothing of the media server's own: no cache rule, no other security header.
  assert.equal(answer.headers["cache-control"], undefined)
  assert.equal(answer.headers["x-content-type-options"], undefined)
})

test("a redirect is passed on as it is, Location untouched and not followed", async () => {
  await start(nextcloud)
  const answer = await ask("/apps/hjemmeserver/redirect")
  assert.equal(answer.status, 302)
  assert.equal(answer.headers.location, "https://sky.test/index.php/login?redirect_url=%2Fapps%2Fhjemmeserver%2F")
  assert.equal(seen.length, 1)
})

test("a mounted home app, its sub-paths and its bare base stay with the server (and the gate); the proxy never sees them", async () => {
  await start(nextcloud)
  for (const path of ["/apps/hjemmeserver/penger/", "/apps/hjemmeserver/penger/api/x.json", "/apps/hjemmeserver/penger/aktive"]) {
    const answer = await ask(path)
    assert.equal(answer.status, 302, path)
    assert.equal(answer.headers.location, "https://login.test/")
  }
  assert.equal((await ask("/apps/hjemmeserver/penger")).status, 302)
  assert.equal(seen.length, 0)
  assert.equal(gateChecked.length, 4)
  // A sibling whose name merely starts the same is Nextcloud's.
  assert.equal((await ask("/apps/hjemmeserver/pengerx/")).status, 200)
  assert.equal(seen.length, 1)
})

test("outside /apps/hjemmeserver/ nothing is proxied: the gate and the 404 are as before", async () => {
  await start(nextcloud)
  assert.equal((await ask("/remote.php/dav/")).status, 302)
  assert.equal((await ask("/apps/hjemmeserverx/")).status, 302)
  assert.equal(seen.length, 0)
})

test("an upstream that is down is a 502 with a log line", async () => {
  await start(nextcloud, true)
  const answer = await ask("/apps/hjemmeserver/oversikt/")
  assert.equal(answer.status, 502)
  assert.equal(answer.body, "Bad gateway\n")
  assert.match(logged.join("\n"), /media-proxy: GET \/apps\/hjemmeserver\/oversikt\/: /)
})

test("an upstream that does not answer in time is a 502", async () => {
  await start(nextcloud)
  const answer = await ask("/apps/hjemmeserver/slow")
  assert.equal(answer.status, 502)
  assert.match(logged.join("\n"), /no answer from/)
})

test("a visitor who leaves ends the upstream request", async () => {
  let closed: () => void = () => {}
  const upstreamClosed = new Promise<void>((done) => (closed = done))
  await start(() => (req, res) => {
    res.writeHead(200).write("started")
    req.on("close", () => {
      if (!res.writableFinished) closed()
    })
  })
  await new Promise<void>((done) => {
    const req = request({ host: "127.0.0.1", port: frontPort, path: "/apps/hjemmeserver/hang" }, (res) => {
      res.once("data", () => {
        req.destroy()
        done()
      })
    })
    req.end()
  })
  await upstreamClosed
})
