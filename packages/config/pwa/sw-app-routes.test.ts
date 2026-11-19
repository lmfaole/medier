import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { appOfScope, appStrategyFor, staleCaches } from './sw-app-routes.ts'

const ORIGIN = 'https://sky.lmfaole.party'
const SCOPE = '/apps/hjemmeserver/penger/'
const decide = (path: string, init: { method?: string; origin?: string } = {}) => appStrategyFor({ method: init.method ?? 'GET', url: `${init.origin ?? ORIGIN}${path}` }, ORIGIN, SCOPE)

test('the app\'s own pages and files are network-first', () => {
  assert.equal(decide('/apps/hjemmeserver/penger/'), 'network-first')
  assert.equal(decide('/apps/hjemmeserver/penger/aktive'), 'network-first')
  assert.equal(decide('/apps/hjemmeserver/penger/_astro/Page.Cx9fA1.js'), 'network-first')
  assert.equal(decide('/apps/hjemmeserver/penger/manifest.webmanifest'), 'network-first')
})

test('an API file, a server island, the worker, another app, another origin and anything but a GET are left to the browser', () => {
  assert.equal(decide('/apps/hjemmeserver/penger/api/abonnement.json'), 'ignore')
  assert.equal(decide('/apps/hjemmeserver/penger/_server-islands/Freshness?e=1'), 'ignore')
  assert.equal(decide('/apps/hjemmeserver/penger/sw.js'), 'ignore')
  assert.equal(decide('/apps/hjemmeserver/hjem/'), 'ignore')
  assert.equal(decide('/apps/hjemmeserver/pengerx/'), 'ignore')
  assert.equal(decide('/remote.php/dav/files/ole/Apper/abonnement.json'), 'ignore')
  assert.equal(decide('/apps/hjemmeserver/penger/', { origin: 'https://example.test' }), 'ignore')
  assert.equal(decide('/apps/hjemmeserver/penger/', { method: 'POST' }), 'ignore')
  assert.equal(decide('/apps/hjemmeserver/penger/share', { method: 'PUT' }), 'ignore')
})

test('only this app\'s own old caches go, never the hub\'s or another app\'s', () => {
  assert.deepEqual(staleCaches(['penger-v1', 'penger-shell-b2', 'penger-shell-b3', 'pwa-abc', 'hjem-v1', 'pengerx-1'], 'penger', 'penger-shell-b3'), ['penger-v1', 'penger-shell-b2'])
  assert.equal(appOfScope(SCOPE), 'penger')
  assert.equal(appOfScope('/apps/hjemmeserver/penger'), 'penger')
})
