import { strict as assert } from "node:assert"
import { test } from "node:test"

import { cacheKey, withEdgeCache } from "./edge-cache.ts"
import { installEdgeCache } from "./worker-test-kit.ts"

const stored = installEdgeCache()

const keyFor = (address: string) => cacheKey(new URL(address), 3).url

test("cacheKey keeps each query apart", () => {
  assert.notEqual(keyFor("https://music.example/api/charts.json?period=2025"), keyFor("https://music.example/api/charts.json?period=all"))
})

test("cacheKey ignores parameter order and the fragment", () => {
  assert.equal(keyFor("https://music.example/api/charts.json?period=2025&b=1#top"), keyFor("https://music.example/api/charts.json?b=1&period=2025"))
})

test("cacheKey namespaces by data version", () => {
  assert.equal(keyFor("https://music.example/api/periods.json"), "https://music.example/__edge-cache/v3/api/periods.json")
})

test("a 200 is built once, then served from the cache", async () => {
  const url = new URL("https://music.example/api/once.json")
  let builds = 0
  const build = async () => new Response(String(++builds), { status: 200 })

  const first = await withEdgeCache(url, 1, build)
  assert.equal(first.headers.get("X-Edge-Cache"), "MISS")
  const second = await withEdgeCache(url, 1, build)
  assert.equal(second.headers.get("X-Edge-Cache"), "HIT")
  assert.equal(await second.text(), "1")
  assert.equal(builds, 1)
})

test("a new data version rebuilds, which is the only way a cached answer is replaced", async () => {
  const url = new URL("https://music.example/api/bumped.json")
  let builds = 0
  const build = async () => new Response(String(++builds), { status: 200 })

  await withEdgeCache(url, 1, build)
  assert.equal(await (await withEdgeCache(url, 2, build)).text(), "2")
})

test("an error is never stored", async () => {
  const url = new URL("https://music.example/api/flaky.json")
  await withEdgeCache(url, 1, async () => new Response("down", { status: 503 }))
  assert.equal(stored.has(cacheKey(url, 1).url), false)
})

test("without Workers' cache (the Node server) a 200 is kept in memory all the same", async () => {
  const workers: unknown = Reflect.get(globalThis, "caches")
  Reflect.deleteProperty(globalThis, "caches")
  try {
    const url = new URL("https://music.example/covers/memory.jpg")
    let builds = 0
    const build = async () => new Response(`image ${++builds}`, { status: 200, headers: { "Content-Type": "image/jpeg" } })
    const first = await withEdgeCache(url, 1, build)
    assert.equal(first.headers.get("X-Edge-Cache"), "MISS")
    const second = await withEdgeCache(url, 1, build)
    assert.equal(second.headers.get("X-Edge-Cache"), "HIT")
    assert.equal(await second.text(), "image 1")
    assert.equal(second.headers.get("Content-Type"), "image/jpeg")
    assert.equal(builds, 1)
    const failed = await withEdgeCache(new URL("https://music.example/covers/gone.jpg"), 1, async () => new Response("no", { status: 404 }))
    assert.equal(failed.status, 404)
  } finally {
    Reflect.set(globalThis, "caches", workers)
  }
})
