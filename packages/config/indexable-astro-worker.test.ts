import { strict as assert } from "node:assert"
import { test } from "node:test"

import { createIndexableAstroWorker } from "./indexable-astro-worker.ts"
import { assetsServing, fetchPath } from "./worker-test-kit.ts"

const worker = createIndexableAstroWorker(async () => Response.json({ ok: true }))
const asking = (agent: string) => fetchPath(worker, "/api/x.json", { init: { headers: { "user-agent": agent } } })

test("a search engine gets the page without a robots header", async () => {
  const answer = await asking("Mozilla/5.0 (compatible; Googlebot/2.1)")
  assert.deepEqual([answer.status, answer.headers.get("X-Robots-Tag"), Boolean(answer.headers.get("Content-Security-Policy"))], [200, null, true])
})

test("an AI crawler is refused", async () => {
  assert.equal((await asking("Mozilla/5.0 (compatible; GPTBot/1.0)")).status, 403)
})

test("an inline script of a page is allowed by its hash, and nothing else", async () => {
  const page = createIndexableAstroWorker(async () => new Response("<html><script>window.island = 1</script></html>", { headers: { "Content-Type": "text/html" } }))
  const policy = (await fetchPath(page, "/kilder", { env: { ASSETS: assetsServing("not found", { status: 404 }) } })).headers.get("Content-Security-Policy") ?? ""
  assert.match(policy, /script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/)
  assert.doesNotMatch(policy, /script-src[^;]*unsafe-inline/)
})
