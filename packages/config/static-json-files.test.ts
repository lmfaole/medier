import { strict as assert } from "node:assert"
import { test } from "node:test"

import { apiRequestOf, snapshotPath, staticJsonFiles } from "./static-json-files.ts"
import { assetsServing, getRoute } from "./worker-test-kit.ts"

const JSON_HEADERS = { headers: { "Content-Type": "application/json" } }

test("a file without parameters is its own path", () => {
  assert.equal(snapshotPath(new URL("https://x.test/api/cv.json")), "/api/cv.json")
})

test("parameters are sorted into the file name", () => {
  assert.equal(snapshotPath(new URL("https://x.test/api/charts.json?period=2024")), "/api/charts/period=2024.json")
  assert.equal(snapshotPath(new URL("https://x.test/api/a.json?b=2&a=1")), "/api/a/a=1,b=2.json")
})

test("a path or parameter that is not a file name is refused", () => {
  for (const url of ["/api/x.json?period=../etc", "/api/nope", "/api/a/b.json", "/other.json"]) {
    assert.equal(snapshotPath(new URL(url, "https://x.test")), null, url)
  }
})

test("serves the snapshot file with the API headers", async () => {
  const handler = staticJsonFiles({ assets: () => assetsServing(JSON.stringify({ person: "Ada" }), JSON_HEADERS) })
  const response = await getRoute(handler, "/api/cv.json")
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { person: "Ada" })
  assert.match(response.headers.get("Content-Type") ?? "", /application\/json/)
})

test("a file the store does not have is a JSON 404, not the shell", async () => {
  const handler = staticJsonFiles({ assets: () => assetsServing("<html></html>", { headers: { "Content-Type": "text/html" } }) })
  const response = await getRoute(handler, "/api/missing.json")
  assert.equal(response.status, 404)
  assert.equal(response.headers.get("Cache-Control"), "no-store")
})

test("the store is asked under its prefix when it keeps files under the base", async () => {
  const assets = assetsServing(JSON.stringify({ ok: true }), JSON_HEADERS)
  const handler = staticJsonFiles({ assets: () => assets, assetBase: "/apps/film" })
  assert.equal((await getRoute(handler, "/api/overview.json")).status, 200)
  assert.deepEqual(assets.paths, ["/apps/film/api/overview.json"])
})

test("a snapshot file name is read back into the request it was made from", () => {
  for (const request of ["/api/cv.json", "/api/charts.json?period=2024", "/api/a.json?a=1&b=2", "/api/entity.json?kind=film&slug=x.y-z_1"]) {
    const url = new URL(request, "https://x.test")
    const path = snapshotPath(url)
    assert.ok(path !== null, request)
    const read = apiRequestOf(new URL(path, "https://x.test"))
    assert.equal(read?.pathname, url.pathname, request)
    assert.equal(read?.search, url.search, request)
    assert.equal(apiRequestOf(url)?.href, read?.href, request)
  }
})

test("a request is normalised to sorted parameters and anything unsafe is refused", () => {
  assert.equal(apiRequestOf(new URL("https://x.test/api/a.json?b=2&a=1"))?.search, "?a=1&b=2")
  for (const url of ["/api/x.json?period=../etc", "/api/x.json?a=%0A", "/api/nope", "/api/a/b.json", "/api/a/p=1.json?q=2", "/api/a/p=1,q.json", "/other.json", "/api/../x.json"]) {
    assert.equal(apiRequestOf(new URL(url, "https://x.test")), null, url)
  }
})
