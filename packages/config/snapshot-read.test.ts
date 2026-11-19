import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import * as v from 'valibot'

import { readSnapshot } from './snapshot-read.ts'
import { assetsServing } from './worker-test-kit.ts'

const Answer = v.object({ total: v.number() })
const json = { 'Content-Type': 'application/json' }

test('readSnapshot parses the file the store holds, and a variant has its own file', async () => {
  const assets = assetsServing('{"total":3}', { headers: json })
  assert.deepEqual(await readSnapshot({ assets: () => assets }, 'https://example.test', 'summary', Answer, { period: 'year', value: '2025' }), { total: 3 })
  assert.deepEqual(assets.paths, ['/api/summary/period=year,value=2025.json'])
})

test('readSnapshot prefixes the store path with the dev base', async () => {
  const assets = assetsServing('{"total":3}', { headers: json })
  await readSnapshot({ assets: () => assets, assetBase: '/app' }, 'https://example.test', 'summary', Answer)
  assert.deepEqual(assets.paths, ['/app/api/summary.json'])
})

test('readSnapshot throws, naming the file, for a missing file or one of the wrong shape', async () => {
  const shell = assetsServing('<html>', { headers: { 'Content-Type': 'text/html' } })
  await assert.rejects(readSnapshot({ assets: () => shell }, 'https://example.test', 'summary', Answer), /summary/)
  const wrong = assetsServing('{"total":"3"}', { headers: json })
  await assert.rejects(readSnapshot({ assets: () => wrong }, 'https://example.test', 'summary', Answer), /summary does not match its schema/)
})
