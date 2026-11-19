/**
 * The media server end to end, against a stub Nextcloud (it knows one cookie, the owner's) and the real local databases,
 * read-only. It is opt-in, `MEDIA_SMOKE=1 node --test --test-reporter=spec scripts/media-server.test.ts`, because it needs `.data/`
 * and finished builds (`npm run media:build`): `npm run verify` builds the apps at the same time as it tests, and a page
 * loaded while its build is being rewritten is a 500. Without the variable, `.data/` or the builds every test is skipped.
 * The timings are printed as diagnostics.
 */

import { strict as assert } from "node:assert"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import * as v from "valibot"

import type { LoginGate } from "@designsystem/config/login-gate"

import { MEDIA_APPS } from "./apps.ts"
import type { MediaAppSpec } from "./media-registry.ts"
import { createMediaServer, defaultApps, type MediaServer } from "./media-server.ts"

const root = join(import.meta.dirname, "..")
const ready = process.env["MEDIA_SMOKE"] === "1" && existsSync(join(root, ".data", "film.db")) && existsSync(join(root, "apps", "film", "web", "dist", "server", "entry.mjs"))
const skip = ready ? false : "opt-in (MEDIA_SMOKE=1); needs .data/ and `npm run media:build`"

const OWNER = "nc_session_id=owner-session"
const STRANGER = "nc_session_id=stranger-session"

let nextcloud: Server
let media: MediaServer
let origin = ""
const asked: { host: string | undefined; ocs: string | undefined }[] = []

function portOf(server: Server): number {
  const address = server.address()
  return address !== null && typeof address === "object" ? address.port : 0
}

before(async () => {
  if (!ready) return
  nextcloud = createServer((request, response) => {
    asked.push({ host: request.headers.host, ocs: request.headers["ocs-apirequest"]?.toString() })
    const cookie = request.headers.cookie ?? ""
    if (cookie.includes("owner-session")) response.end(JSON.stringify({ ocs: { data: { id: "ole" } } }))
    else if (cookie.includes("stranger-session")) response.end(JSON.stringify({ ocs: { data: { id: "anna" } } }))
    else response.writeHead(401).end()
  })
  await new Promise<void>((done) => nextcloud.listen(0, "127.0.0.1", done))
  media = await createMediaServer({
    rootDirectory: root,
    dataDirectory: join(root, ".data"),
    nextcloudUrl: `http://127.0.0.1:${portOf(nextcloud)}`,
    nextcloudHost: "sky.test",
    ownerId: "ole",
    log: () => {},
  })
  await new Promise<void>((done) => media.server.listen(0, "127.0.0.1", done))
  origin = `http://127.0.0.1:${portOf(media.server)}`
})

after(async () => {
  if (!ready) return
  await media.close()
  nextcloud.closeAllConnections()
  nextcloud.close()
})

async function timed(path: string, init: RequestInit = {}): Promise<{ response: Response; text: string; ms: number }> {
  const started = performance.now()
  const response = await fetch(`${origin}${path}`, { redirect: "manual", ...init })
  const text = await response.text()
  return { response, text, ms: performance.now() - started }
}
const owner = (headers: Record<string, string> = {}) => ({ headers: { cookie: OWNER, ...headers } })
const page = { "sec-fetch-dest": "document" }

test("health is open; everything else sends a visitor without a session to the login and a script to a 401", { skip }, async (context) => {
  assert.equal((await timed("/healthz")).response.status, 200)
  const visitor = await timed("/apps/medier/film/", { headers: page })
  assert.equal(visitor.response.status, 302)
  assert.equal(visitor.response.headers.get("Location"), `https://sky.test/login?redirect_url=${encodeURIComponent("/apps/medier/film/")}`)
  assert.equal((await timed("/apps/medier/film/api/overview.json")).response.status, 401)
  const stranger = await timed("/apps/medier/film/", { headers: { cookie: STRANGER, ...page } })
  assert.equal(stranger.response.status, 403)
  assert.ok(asked.every((one) => one.host === "sky.test" && one.ocs === "true"), "Nextcloud is asked by its public name")
  context.diagnostic(`gate: anonymous redirect ${visitor.ms.toFixed(1)} ms`)
})

test("a film page, its API and an entity are served from the database for the owner", { skip }, async (context) => {
  const first = await timed("/apps/medier/film/", owner(page))
  assert.equal(first.response.status, 200)
  assert.match(first.response.headers.get("Content-Security-Policy") ?? "", /script-src 'self'( 'sha256-[^']+')+/)
  assert.equal(first.response.headers.get("Cache-Control"), "private, max-age=0, must-revalidate")
  assert.match(first.text, /<title>Film<\/title>/)
  const second = await timed("/apps/medier/film/", owner(page))
  context.diagnostic(`film front page: first ${first.ms.toFixed(0)} ms (loads the build), then ${second.ms.toFixed(0)} ms`)

  const overview = await timed("/apps/medier/film/api/overview.json", owner())
  assert.equal(overview.response.status, 200)
  const etag = overview.response.headers.get("ETag") ?? ""
  assert.ok(etag)
  const again = await timed("/apps/medier/film/api/overview.json", owner({ "If-None-Match": etag }))
  assert.equal(again.response.status, 304)
  context.diagnostic(`film api/overview.json: ${overview.ms.toFixed(1)} ms, revalidated ${again.ms.toFixed(1)} ms`)

  const library = v.parse(v.object({ works: v.array(v.object({ slug: v.string() })) }), JSON.parse((await timed("/apps/medier/film/api/library.json", owner())).text))
  const slug = library.works[0]?.slug
  {
    const entity = await timed(`/apps/medier/film/api/entity.json?kind=film&slug=${slug}`, owner())
    assert.equal(entity.response.status, 200)
    const card = await timed(`/apps/medier/film/film/${slug}`, owner(page))
    assert.equal(card.response.status, 200)
    context.diagnostic(`film entity api ${entity.ms.toFixed(1)} ms, entity page ${card.ms.toFixed(0)} ms`)
  }
  assert.equal((await timed("/apps/medier/film/api/nope.json", owner())).response.status, 404)
  assert.equal((await timed("/apps/medier/film/api/history.json?month=../x", owner())).response.status, 404)
})

test("the static files of the build are served under the base", { skip }, async () => {
  const manifest = await timed("/apps/medier/manifest.webmanifest", owner())
  assert.equal(manifest.response.status, 200)
  assert.equal((await timed("/apps/medier/sw.js", owner())).response.status, 200)
  assert.equal((await timed("/apps/medier/", owner(page))).response.status, 200)
  assert.equal((await timed("/apps/film/historikk", owner(page))).response.headers.get("Location"), "/apps/medier/film/historikk")
  assert.equal((await timed("/apps/medier/film/_astro/missing.js", owner())).response.status, 404)
  assert.equal((await timed("/apps/medier/film", owner(page))).response.status, 308)
  assert.equal((await timed("/apps/medier/film/history", owner(page))).response.status, 301)
})

test("music is up, and every other app answers its front page", { skip }, async (context) => {
  const music = await timed("/apps/medier/musikk/", owner(page))
  assert.equal(music.response.status, 200)
  context.diagnostic(`music front page: ${music.ms.toFixed(0)} ms`)
  for (const [app, base] of [["podkast", "/apps/medier/podkast"], ["tv", "/apps/medier/tv"], ["games", "/apps/medier/spill"], ["books", "/apps/medier/boker"], ["boardgames", "/apps/medier/brettspill"]] as const) {
    if (!existsSync(join(root, "apps", app, "web", "dist", "server", "entry.mjs"))) continue
    const answer = await timed(`${base}/`, owner(page))
    assert.equal(answer.response.status, 200, app)
    context.diagnostic(`${app} front page: ${answer.ms.toFixed(0)} ms`)
  }
  context.diagnostic(`all ${MEDIA_APPS.length} apps touched, resident set ${(process.memoryUsage().rss / 1048576).toFixed(0)} MB (this test process, server included)`)
})

/**
 * A home app, mounted at `/apps/hjemmeserver/<name>` and answering from files. A stub on a temporary root, with a handler standing in for its
 * Astro build and a gate that knows one cookie: nothing here needs `.data/` or a build, so it always runs.
 */
test("a home app is mounted next to the others, at its own base, and answers from the exporters' folder behind the login, read-only", async () => {
  const stubRoot = mkdtempSync(join(tmpdir(), "media-server-home-"))
  const files = join(stubRoot, "apper")
  const app = join(stubRoot, "apps", "stub", "web")
  mkdirSync(files, { recursive: true })
  mkdirSync(join(app, "src", "server"), { recursive: true })
  mkdirSync(join(app, "dist", "server"), { recursive: true })
  mkdirSync(join(app, "dist", "client", "_astro"), { recursive: true })
  writeFileSync(join(files, "status.json"), JSON.stringify({ n: 7 }))
  writeFileSync(join(app, "src", "server", "api.ts"), `import * as v from ${JSON.stringify(import.meta.resolve("valibot"))}\nimport { jsonFile } from ${JSON.stringify(new URL("../packages/config/apper-files.ts", import.meta.url).href)}\nexport const DOMAINS = []\nexport const API = { status: jsonFile("status.json", v.object({ n: v.number() })) }\n`)
  writeFileSync(join(app, "dist", "server", "entry.mjs"), 'export const handler = (request, response) => { response.writeHead(200, { "Content-Type": "text/html" }); response.end("<html><script>1</script>stub</html>") }\n')
  writeFileSync(join(app, "dist", "client", "sw.js"), "// worker")
  const stub: MediaAppSpec = { name: "stub", base: "/apps/hjemmeserver/stub", moved: {} }
  const gate: LoginGate = {
    verdictKeys: () => [],
    check: async (request) => (request.headers.get("cookie")?.includes("owner-session") ? undefined : new Response("", { status: 401 })),
  }
  const home = await createMediaServer({ rootDirectory: stubRoot, dataDirectory: join(stubRoot, "data"), apperDirectory: files, nextcloudUrl: "http://nextcloud.test", nextcloudHost: "sky.test", ownerId: "ole", specs: [stub], gate, log: () => {} })
  await new Promise<void>((done) => home.server.listen(0, "127.0.0.1", done))
  const at = `http://127.0.0.1:${portOf(home.server)}`
  const get = (path: string, init: RequestInit = {}) => fetch(`${at}${path}`, { redirect: "manual", ...init })
  const asOwner = { headers: { cookie: OWNER } }
  try {
    assert.deepEqual([...home.hosts.keys()], ["stub"])
    assert.equal((await get("/healthz")).status, 200)
    assert.equal((await get("/apps/hjemmeserver/stub/api/status.json")).status, 401)
    assert.equal((await get("/apps/hjemmeserver/stub/")).status, 401)

    const api = await get("/apps/hjemmeserver/stub/api/status.json", asOwner)
    assert.equal(api.status, 200)
    assert.deepEqual(await api.json(), { n: 7 })
    assert.equal(api.headers.get("Cache-Control"), "no-store")
    assert.ok(api.headers.get("Content-Security-Policy"), "the security headers are on a file answer too")
    assert.equal((await get("/apps/hjemmeserver/stub/api/other.json", asOwner)).status, 404)

    const front = await get("/apps/hjemmeserver/stub/", asOwner)
    assert.equal(front.status, 200)
    assert.match(front.headers.get("Content-Security-Policy") ?? "", /script-src 'self'( 'sha256-[^']+')+/)
    assert.equal(front.headers.get("Cache-Control"), "private, max-age=0, must-revalidate")
    assert.equal((await get("/apps/hjemmeserver/stub/sw.js", asOwner)).status, 200)
    assert.equal((await get("/apps/hjemmeserver/stub", asOwner)).status, 308)
    // An unmounted path under the prefix is Nextcloud's (proxied, before the gate; here Nextcloud is not there: 502); another prefix is a 404.
    assert.equal((await get("/apps/hjemmeserver/other/")).status, 502)
    assert.equal((await get("/apps/other/", asOwner)).status, 404)

    // There is no write route: a POST, a PUT and a DELETE are all refused, and the folder is as it was.
    for (const method of ["POST", "PUT", "DELETE"]) assert.equal((await get("/apps/hjemmeserver/stub/api/status.json", { method, body: method === "DELETE" ? null : "{}", ...asOwner })).status, 405, method)
    assert.deepEqual(await (await get("/apps/hjemmeserver/stub/api/status.json", asOwner)).json(), { n: 7 })

    // A file that arrives while the server runs is read at once, a file that goes is a 404.
    writeFileSync(join(files, "status.json"), JSON.stringify({ n: 8 }))
    assert.deepEqual(await (await get("/apps/hjemmeserver/stub/api/status.json", asOwner)).json(), { n: 8 })
    rmSync(join(files, "status.json"))
    assert.equal((await get("/apps/hjemmeserver/stub/api/status.json", asOwner)).status, 404)
  } finally {
    await home.close()
    rmSync(stubRoot, { recursive: true, force: true })
  }
})

test("an app named that no spec has is refused, and the default mount is the media apps and the hub plus each home app that has code", async () => {
  const stubRoot = mkdtempSync(join(tmpdir(), "media-server-default-"))
  try {
    await assert.rejects(createMediaServer({ rootDirectory: stubRoot, dataDirectory: stubRoot, nextcloudUrl: "http://nextcloud.test", nextcloudHost: "sky.test", ownerId: "ole", only: ["nope"], login: false, log: () => {} }), /unknown app nope/)
    assert.deepEqual(defaultApps(stubRoot), [...MEDIA_APPS])
    mkdirSync(join(stubRoot, "apps", "penger", "web", "src", "server"), { recursive: true })
    assert.deepEqual(defaultApps(stubRoot), [...MEDIA_APPS])
    writeFileSync(join(stubRoot, "apps", "penger", "web", "src", "server", "api.ts"), "")
    assert.deepEqual(defaultApps(stubRoot), [...MEDIA_APPS, "penger"])
  } finally {
    rmSync(stubRoot, { recursive: true, force: true })
  }
})
