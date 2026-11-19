import { strict as assert } from "node:assert"
import { test } from "node:test"

import { AI_AND_SEO_CRAWLERS, CACHE_IMMUTABLE, CACHE_STANDARD, SECURITY_HEADERS } from "./security-headers.ts"
import { createWorkerApp } from "./worker-app.ts"
import { assetsServing, fetchPath, installEdgeCache } from "./worker-test-kit.ts"

installEdgeCache()

const quietly = async <T>(run: () => Promise<T>): Promise<T> => {
  const original = console.error
  console.error = () => {}
  try {
    return await run()
  } finally {
    console.error = original
  }
}

const app = createWorkerApp({
  prefixRoutes: { "/covers/": ({ url }) => new Response(`cover ${url.pathname}`) },
  fallback: (context) => context.assets(),
})

test("refuses a listed crawler with 403 before any route or asset", async () => {
  const response = await fetchPath(app, "/covers/a.jpg", { init: { headers: { "user-agent": "Mozilla/5.0 (compatible; GPTBot/1.0)" } } })
  assert.equal(response.status, 403)
  assert.equal(response.headers.get("Cache-Control"), CACHE_STANDARD)
})

test("an app that lets search engines in refuses only the other crawlers", async () => {
  const indexable = createWorkerApp({ blockedCrawlers: AI_AND_SEO_CRAWLERS, fallback: (context) => context.assets() })
  const get = (agent: string) => fetchPath(indexable, "/", { env: { ASSETS: assetsServing("<html>") }, init: { headers: { "user-agent": agent } } })
  assert.equal((await get("Mozilla/5.0 (compatible; Googlebot/2.1)")).status, 200)
  assert.equal((await get("Mozilla/5.0 (compatible; GPTBot/1.0)")).status, 403)
})

test("serves a page from assets with every security header and the revalidating cache rule", async () => {
  const response = await fetchPath(app, "/", { env: { ASSETS: assetsServing("<html>") } })
  assert.equal(await response.text(), "<html>")
  assert.equal(response.headers.get("Cache-Control"), CACHE_STANDARD)
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) assert.equal(response.headers.get(name), value)
})

test("serves hashed build output with the immutable cache rule", async () => {
  const response = await fetchPath(app, "/assets/index-abc123.js", { env: { ASSETS: assetsServing("") } })
  assert.equal(response.headers.get("Cache-Control"), CACHE_IMMUTABLE)
})

test("a prefix route answers every path under it", async () => {
  assert.equal(await (await fetchPath(app, "/covers/a/b.jpg")).text(), "cover /covers/a/b.jpg")
})

test("an exception answers the shared 500 page, still with every security header", async () => {
  const brokenAssets = { fetch: async () => { throw new Error("asset store unreachable") } }
  const response = await quietly(() => fetchPath(app, "/", { env: { ASSETS: brokenAssets } }))
  assert.equal(response.status, 500)
  assert.match(await response.text(), /Noe gikk galt/)
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) assert.equal(response.headers.get(name), value)
})

test("a hashed asset the store does not have is a 404 that is never cached, not the shell under a year-long rule", async () => {
  const spaFallback = { fetch: async () => new Response("<html>shell</html>", { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }) }
  const response = await fetchPath(app, "/assets/index-old123.js", { env: { ASSETS: spaFallback } })
  assert.equal(response.status, 404)
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) assert.equal(response.headers.get(name), value)
})

test("a missing image under /media/ the store answers with the shell for is a 404 that is never cached", async () => {
  const spaFallback = { fetch: async () => new Response("<html>shell</html>", { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }) }
  const response = await fetchPath(app, "/media/spill-2018/Stortinget/images/typo.jpg", { env: { ASSETS: spaFallback } })
  assert.equal(response.status, 404)
  assert.equal(response.headers.get("Cache-Control"), "no-store")
})

test("an image under /media/ that exists keeps the immutable rule", async () => {
  const store = { fetch: async () => new Response("bytes", { headers: { "Content-Type": "image/jpeg" } }) }
  const response = await fetchPath(app, "/media/spill-2018/Stortinget/images/wheel.jpg", { env: { ASSETS: store } })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("Cache-Control"), CACHE_IMMUTABLE)
})
