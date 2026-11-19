import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { createAstroWorker } from './astro-worker.ts'
import { AI_AND_SEO_CRAWLERS, INDEXABLE_HEADERS } from './security-headers.ts'
import { assetsServing, fetchPath } from './worker-test-kit.ts'
import type { WorkerEnv } from './worker-app.ts'

/** Astro's answer echoes the URL it was handed, as the island does: it works out its own base from it. */
const worker = (basePath: string) =>
  createAstroWorker<WorkerEnv>({
    render: async (request) => new Response(`<p>${new URL(request.url).pathname}</p>`, { headers: { 'Content-Type': 'text/html' } }),
    headers: INDEXABLE_HEADERS,
    blockedCrawlers: AI_AND_SEO_CRAWLERS,
    basePath,
    assetsUnderBase: false,
  })

const missing = { ASSETS: assetsServing('not found', { status: 404 }) }

test('a server island is answered by Astro behind the security headers, under any base', async () => {
  for (const [base, path] of [['/', '/_server-islands/Freshness?e=1'], ['/apps/film/', '/apps/film/_server-islands/Freshness?e=1']] as const) {
    const answer = await fetchPath(worker(base), path, { env: missing })
    assert.equal(answer.status, 200, path)
    assert.equal(await answer.text(), `<p>${path.split('?')[0]}</p>`, 'Astro sees the URL as received, base included')
    assert.match(answer.headers.get('Content-Security-Policy') ?? '', /default-src 'none'/)
    assert.equal(answer.headers.get('Cache-Control'), 'public, max-age=0, must-revalidate')
  }
})

test('a server island is refused to a blocked crawler like any other path', async () => {
  const answer = await fetchPath(worker('/'), '/_server-islands/Freshness', { env: missing, init: { headers: { 'user-agent': 'Mozilla/5.0 (compatible; GPTBot/1.0)' } } })
  assert.equal(answer.status, 403)
})

test('a server island posted by a page is answered the same as one fetched', async () => {
  const answer = await fetchPath(worker('/'), '/_server-islands/Freshness', { env: missing, init: { method: 'POST', body: '{}' } })
  assert.equal(answer.status, 200)
})

test('a request for an API file is told so, so its query is not lost to the asset store, and it gets the API cache rule', async () => {
  const kinds: boolean[] = []
  const api = createAstroWorker<WorkerEnv>({
    render: async (_request, _env, _ctx, kind) => {
      kinds.push(kind.api)
      return new Response('{}', { headers: { 'Content-Type': 'application/json' } })
    },
    basePath: '/apps/film/',
    assetsUnderBase: false,
  })
  const asked = async (path: string) => (await fetchPath(api, path, { env: missing })).headers.get('Cache-Control')
  assert.match((await asked('/apps/film/api/charts.json?period=2024')) ?? '', /max-age=600/)
  await asked('/apps/film/historikk')
  assert.deepEqual(kinds, [true, false])
})
