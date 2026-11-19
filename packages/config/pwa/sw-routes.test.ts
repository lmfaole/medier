import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { isCacheable, strategyFor } from './sw-routes.ts'

const ORIGIN = 'https://sky.lmfaole.party'
const BASE = '/apps/medier'
const decide = (path: string, init: { method?: string; hasRange?: boolean; origin?: string } = {}) =>
  strategyFor({ method: init.method ?? 'GET', url: `${init.origin ?? ORIGIN}${path}`, hasRange: init.hasRange ?? false }, ORIGIN, BASE)

test('pages and the API are network-first, so a fresh deploy and fresh data always win', () => {
  assert.equal(decide('/apps/medier/'), 'network-first')
  assert.equal(decide('/apps/medier/film/'), 'network-first')
  assert.equal(decide('/apps/medier/film/historikk?month=2025-03'), 'network-first')
  assert.equal(decide('/apps/medier/film/api/charts.json?period=2025'), 'network-first')
})

test('hashed and content-named files never change, so they are cache-first', () => {
  assert.equal(decide('/apps/medier/film/_astro/Library.Cx9fA1.js'), 'cache-first')
  assert.equal(decide('/apps/medier/film/posters/aB3.jpg'), 'cache-first')
  assert.equal(decide('/apps/medier/_astro/Hub.Cx9fA1.js'), 'cache-first')
  assert.equal(decide('/apps/medier/film/film/posters'), 'network-first')
})

test('anything that is not a plain GET under the hub is left to the browser', () => {
  assert.equal(decide('/apps/medier/film/', { method: 'POST' }), 'ignore')
  assert.equal(decide('/apps/medier/film/media/x.mp3', { hasRange: true }), 'ignore')
  assert.equal(decide('/apps/medier/film/_server-islands/Freshness?e=1'), 'ignore')
  assert.equal(decide('/apps/medier/sw.js'), 'ignore')
  assert.equal(decide('/apps/hjemmeserver/', {}), 'ignore')
  assert.equal(decide('/apps/mediert/'), 'ignore')
  assert.equal(decide('/apps/medier/film/', { origin: 'https://example.test' }), 'ignore')
})

test('only a complete, direct answer is kept', () => {
  assert.equal(isCacheable({ status: 200, redirected: false, type: 'basic' }), true)
  assert.equal(isCacheable({ status: 404, redirected: false, type: 'basic' }), false)
  assert.equal(isCacheable({ status: 200, redirected: true, type: 'basic' }), false)
  assert.equal(isCacheable({ status: 200, redirected: false, type: 'opaque' }), false)
})
