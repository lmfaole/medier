import { strict as assert } from "node:assert"
import { afterEach, beforeEach, test } from "node:test"

import { CACHE_IMMUTABLE } from "@designsystem/config/security-headers"
import { installEdgeCache } from "@designsystem/config/worker-test-kit"
import { coverArtUrl, handleCover } from "./cover-art.ts"

const RELEASE = "f1418001-7f1e-46af-bfdb-95faeded8841"
const COVER = `https://music.example/covers/${RELEASE}/32916450708-250.jpg`

const originalFetch = globalThis.fetch
const originalError = console.error
let upstreamCalls: string[] = []
let upstreamAgents: (string | null)[] = []
let stored = new Map<string, Response>()

beforeEach(() => {
  upstreamCalls = []
  upstreamAgents = []
  console.error = () => {}
  stored = installEdgeCache()
})

afterEach(() => {
  globalThis.fetch = originalFetch
  console.error = originalError
  Reflect.deleteProperty(globalThis, "caches")
})

const upstreamAnswering = (status: number) => {
  globalThis.fetch = async (address: RequestInfo | URL, init?: RequestInit) => {
    upstreamCalls.push(String(address))
    upstreamAgents.push(new Headers(init?.headers).get("User-Agent"))
    return new Response(status === 200 ? "jpeg bytes" : null, { status, headers: { "Content-Type": "image/jpeg" } })
  }
}

test("coverArtUrl is a same-origin path to the 250px thumbnail", () => {
  assert.equal(coverArtUrl(`${RELEASE}/32916450708`), `/covers/${RELEASE}/32916450708-250.jpg`)
})

test("coverArtUrl is null without a cover or for one the Worker would not serve", () => {
  assert.equal(coverArtUrl(null), null)
  assert.equal(coverArtUrl("no-slash"), null)
  assert.equal(coverArtUrl("release-1/42"), null)
})

test("fetches a cover from the Cover Art Archive once, then serves it from the edge cache", async () => {
  upstreamAnswering(200)
  const first = await handleCover(new URL(COVER))
  assert.equal(first.status, 200)
  assert.equal(await first.text(), "jpeg bytes")
  assert.equal(first.headers.get("Cache-Control"), CACHE_IMMUTABLE)
  assert.equal(first.headers.get("Content-Type"), "image/jpeg")

  const second = await handleCover(new URL(`${COVER}?ignored=1`))
  assert.equal(second.headers.get("X-Edge-Cache"), "HIT")
  assert.equal(await second.text(), "jpeg bytes")
  assert.deepEqual(upstreamCalls, [`https://archive.org/download/mbid-${RELEASE}/mbid-${RELEASE}-32916450708_thumb250.jpg`])
  assert.match(upstreamAgents[0] ?? "", /lmfaole\.party\/apps\/medier\/musikk/)
})

test("a cover the archive does not have is a 404 that nothing caches", async () => {
  upstreamAnswering(404)
  const response = await handleCover(new URL(COVER))
  assert.equal(response.status, 404)
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  assert.equal(stored.size, 0)
})

test("an archive outage is a 502, not cached", async () => {
  upstreamAnswering(503)
  assert.equal((await handleCover(new URL(COVER))).status, 502)
  assert.equal(stored.size, 0)
})

test("refuses any other path under /covers/ without contacting the archive", async () => {
  upstreamAnswering(200)
  for (const path of ["/covers/", "/covers/not-a-uuid/1-250.jpg", `/covers/${RELEASE}/1-500.jpg`, `/covers/${RELEASE}/../x-250.jpg`]) {
    assert.equal((await handleCover(new URL(`https://music.example${path}`))).status, 404, path)
  }
  assert.deepEqual(upstreamCalls, [])
})
