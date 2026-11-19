import { strict as assert } from "node:assert"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, test } from "node:test"

import type { LoginGate } from "@designsystem/config/login-gate"

import { type AstroHandler, createMediaRouter, type MountedApp } from "./media-router.ts"

let directory = ""
let server: Server | undefined
const handled: string[] = []

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "media-router-"))
  mkdirSync(join(directory, "_astro"), { recursive: true })
  writeFileSync(join(directory, "_astro", "a.1.js"), "1")
  writeFileSync(join(directory, "robots.txt"), "no")
  handled.length = 0
})
afterEach(async () => {
  server?.closeAllConnections()
  await new Promise((done) => (server === undefined ? done(undefined) : server.close(done)))
  rmSync(directory, { recursive: true, force: true })
})

/** An Astro handler that renders a page with an inline script and answers `next()` for `/apps/film/unmatched`. */
const handler: AstroHandler = (request, response, next) => {
  handled.push(request.url ?? "")
  if (request.url?.includes("unmatched")) return next()
  if (request.url?.includes("boom")) throw new Error("render failed")
  response.writeHead(200, { "Content-Type": "text/html", "Set-Cookie": "a=b" })
  response.write("<html><script>window.x = 1</script>")
  response.end("</html>")
}

const stubGate = (verdict: "owner" | "anonymous"): LoginGate & { checked: string[] } => {
  const checked: string[] = []
  return {
    checked,
    verdictKeys: () => [],
    async check(request) {
      checked.push(new URL(request.url).pathname)
      return verdict === "owner" ? undefined : new Response("", { status: 302, headers: { Location: "https://login.test/" } })
    },
  }
}

function app(overrides: Partial<MountedApp> = {}): MountedApp {
  return {
    base: "/apps/film",
    moved: { "/history": "/historikk" },
    clientDirectory: directory,
    api: {
      fetch: async (request) => {
        const url = new URL(request.url)
        return Response.json({ asked: url.pathname + url.search }, { headers: { ETag: '"e"', "Cache-Control": "private, no-cache" } })
      },
    },
    handler: async () => handler,
    ...overrides,
  }
}

async function start(gate: LoginGate | undefined, apps: MountedApp[] = [app()], movedBases: Record<string, string> = {}, retiredBases: Record<string, string> = {}): Promise<string> {
  server = createServer(createMediaRouter({ apps, movedBases, retiredBases, gate, log: () => {} }))
  await new Promise<void>((done) => server?.listen(0, "127.0.0.1", done))
  const address = server.address()
  return `http://127.0.0.1:${address !== null && typeof address === "object" ? address.port : 0}`
}

const get = (url: string, init: RequestInit = {}) => fetch(url, { redirect: "manual", ...init })

test("an app under the hub's base is found before the hub, and a base an app left goes to where it is now", async () => {
  const hub = app({ base: "/apps/medier", moved: {} })
  const film = app({ base: "/apps/medier/film" })
  const origin = await start(stubGate("owner"), [hub, film], { "/apps/film": "/apps/medier/film" })
  assert.deepEqual(await (await get(`${origin}/apps/medier/film/api/x.json`)).json(), { asked: "/apps/medier/film/api/x.json" })
  assert.equal((await get(`${origin}/apps/medier/film/history`)).headers.get("Location"), "/apps/medier/film/historikk")
  await get(`${origin}/apps/medier/`)
  assert.deepEqual(handled, ["/apps/medier/"])
  const old = await get(`${origin}/apps/film/historikk?month=2025`)
  assert.equal(old.status, 301)
  assert.equal(old.headers.get("Location"), "/apps/medier/film/historikk?month=2025")
  assert.equal((await get(`${origin}/apps/film`)).headers.get("Location"), "/apps/medier/film/")
  assert.equal((await get(`${origin}/apps/filmer/`)).status, 404)
})

test("the old address of a card over a list goes to the page of the thing it named; a malformed one is the list", async () => {
  const film = app({ base: "/apps/medier/spill", moved: {} })
  const origin = await start(stubGate("owner"), [film])
  const old = await get(`${origin}/apps/medier/spill/historikk?month=2025-03&kort=game.hades`)
  assert.equal(old.status, 301)
  assert.equal(old.headers.get("Location"), "/apps/medier/spill/spill/hades")
  const malformed = await get(`${origin}/apps/medier/spill/historikk?kort=../etc`)
  assert.equal(malformed.status, 200)
  assert.deepEqual(handled, ["/apps/medier/spill/historikk?kort=../etc"])
})

test("an app that left the server goes to where its page is now, ahead of the hub its path falls under", async () => {
  const hub = app({ base: "/apps/medier", moved: {} })
  const origin = await start(stubGate("owner"), [hub], {}, { "/apps/medier/rss": "/apps/hjemmeserver/miniflux/" })
  for (const path of ["/apps/medier/rss", "/apps/medier/rss/", "/apps/medier/rss/toppsaker?x=1"]) {
    const answer = await get(`${origin}${path}`)
    assert.equal(answer.status, 301, path)
    assert.equal(answer.headers.get("Location"), "/apps/hjemmeserver/miniflux/", path)
  }
  await get(`${origin}/apps/medier/rssx/`)
  assert.deepEqual(handled, ["/apps/medier/rssx/"])
})

test("/healthz answers without a login and every other path meets the gate first", async () => {
  const gate = stubGate("anonymous")
  const origin = await start(gate)
  assert.equal((await get(`${origin}/healthz`)).status, 200)
  assert.deepEqual(gate.checked, [])
  for (const path of ["/apps/film/", "/apps/film/api/x.json", "/apps/film/_astro/a.1.js", "/apps/film/robots.txt", "/apps/film", "/other", "/"]) {
    const response = await get(`${origin}${path}`)
    assert.equal(response.status, 302, path)
    assert.equal(response.headers.get("Location"), "https://login.test/", path)
  }
  assert.equal(gate.checked.length, 7)
  assert.deepEqual(handled, [], "nothing reached an app")
})

test("the owner gets the page with the security headers, a hash for its inline script and a private cache", async () => {
  const origin = await start(stubGate("owner"))
  const response = await get(`${origin}/apps/film/`)
  assert.equal(response.status, 200)
  assert.match(response.headers.get("Content-Security-Policy") ?? "", /script-src 'self' 'sha256-[A-Za-z0-9+/=]+';/)
  assert.equal(response.headers.get("Cache-Control"), "private, max-age=0, must-revalidate")
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff")
  assert.equal(response.headers.get("Set-Cookie"), "a=b")
  assert.equal(await response.text(), "<html><script>window.x = 1</script></html>")
  assert.deepEqual(handled, ["/apps/film/"])
})

test("the bare base goes to its slash, a moved page to its new address, an address outside every base is a 404", async () => {
  const origin = await start(stubGate("owner"))
  const bare = await get(`${origin}/apps/film?x=1`)
  assert.equal(bare.status, 308)
  assert.equal(bare.headers.get("Location"), "/apps/film/?x=1")
  const moved = await get(`${origin}/apps/film/history?month=all`)
  assert.equal(moved.status, 301)
  assert.equal(moved.headers.get("Location"), "/apps/film/historikk?month=all")
  assert.equal((await get(`${origin}/apps/filmx/`)).status, 404)
  assert.equal((await get(`${origin}/`)).status, 404)
  assert.deepEqual(handled, [])
})

test("/api is the app's fetcher, with the request as received, private to the browser; the page handler is not asked", async () => {
  const origin = await start(stubGate("owner"))
  const response = await get(`${origin}/apps/film/api/history.json?month=2024`)
  assert.deepEqual(await response.json(), { asked: "/apps/film/api/history.json?month=2024" })
  assert.equal(response.headers.get("ETag"), '"e"')
  assert.equal(response.headers.get("Cache-Control"), "private, no-cache")
  assert.ok(response.headers.get("Content-Security-Policy"))
  assert.deepEqual(handled, [])
})

test("files of dist/client are served under the base, a missing hashed file is a 404 and not a page", async () => {
  const origin = await start(stubGate("owner"))
  const script = await get(`${origin}/apps/film/_astro/a.1.js`)
  assert.equal(script.status, 200)
  assert.equal(script.headers.get("Cache-Control"), "private, max-age=31536000, immutable")
  assert.equal((await get(`${origin}/apps/film/_astro/missing.js`)).status, 404)
  assert.equal((await get(`${origin}/apps/film/robots.txt`)).status, 200)
  assert.equal((await get(`${origin}/apps/film/robots.txt`, { headers: { "If-None-Match": (await get(`${origin}/apps/film/robots.txt`)).headers.get("ETag") ?? "" } })).status, 304)
  assert.deepEqual(handled, [])
})

test("an app's own route answers a path with no file, and apps do not see each other's paths", async () => {
  const tv = app({ base: "/apps/tv", extra: async () => undefined })
  const film = app({ extra: async (path) => (path.pathname.startsWith("/covers/") ? new Response("cover", { headers: { "Cache-Control": "public, max-age=31536000, immutable" } }) : undefined) })
  const origin = await start(stubGate("owner"), [film, tv])
  const cover = await get(`${origin}/apps/film/covers/x.jpg`)
  assert.equal(await cover.text(), "cover")
  assert.equal(cover.headers.get("Cache-Control"), "private, max-age=31536000, immutable")
  assert.equal((await get(`${origin}/apps/tv/covers/x.jpg`)).status, 404, "an immutable path with no file is never a page")
  await get(`${origin}/apps/tv/historikk`)
  assert.deepEqual(handled, ["/apps/tv/historikk"])
})

test("a path no Astro route matches is the shared 404 page, and a render that throws is the 500 page", async () => {
  const origin = await start(stubGate("owner"))
  const missing = await get(`${origin}/apps/film/unmatched`)
  assert.equal(missing.status, 404)
  assert.match(await missing.text(), /Siden finnes ikke/)
  const broken = await get(`${origin}/apps/film/boom`)
  assert.equal(broken.status, 500)
  assert.match(await broken.text(), /Noe gikk galt/)
})

test("a POST goes to the app's own write route with its body, and only there; a body that is too large is refused", async () => {
  const seen: string[] = []
  const film = app({ write: async (path, request) => (path.pathname === "/push/subscribe" ? (seen.push(`${path.pathname} ${await request.text()}`), new Response(null, { status: 204 })) : undefined) })
  const tv = app({ base: "/apps/tv" })
  const origin = await start(stubGate("owner"), [film, tv])
  assert.equal((await get(`${origin}/apps/film/push/subscribe`, { method: "POST", body: "{}" })).status, 204)
  assert.deepEqual(seen, ["/push/subscribe {}"])
  assert.equal((await get(`${origin}/apps/film/other`, { method: "POST", body: "{}" })).status, 405)
  assert.equal((await get(`${origin}/apps/tv/push/subscribe`, { method: "POST", body: "{}" })).status, 405)
  assert.equal((await get(`${origin}/apps/film/push/subscribe`, { method: "POST", body: "x".repeat(9000) })).status, 413)
  assert.equal(seen.length, 1)
})

test("a POST is behind the login like everything else", async () => {
  const seen: string[] = []
  const film = app({ write: async () => (seen.push("written"), new Response(null, { status: 204 })) })
  const origin = await start(stubGate("anonymous"), [film])
  assert.equal((await get(`${origin}/apps/film/push/subscribe`, { method: "POST", body: "{}" })).status, 302)
  assert.deepEqual(seen, [])
})

test("only GET and HEAD are served", async () => {
  const origin = await start(stubGate("owner"))
  const post = await get(`${origin}/apps/film/`, { method: "POST", body: "x" })
  assert.equal(post.status, 405)
  assert.equal(post.headers.get("Allow"), "GET, HEAD")
  const head = await get(`${origin}/apps/film/api/x.json`, { method: "HEAD" })
  assert.equal(head.status, 200)
  assert.equal(await head.text(), "")
})

test("without a gate (a development run) everybody is let in", async () => {
  const origin = await start(undefined)
  assert.equal((await get(`${origin}/apps/film/`)).status, 200)
})
