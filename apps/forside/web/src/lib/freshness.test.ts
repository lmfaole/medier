import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { sinceLabel } from './freshness.ts'

const now = new Date('2026-11-04T12:00:00Z')

test('sinceLabel counts in the largest whole unit, rounding down', () => {
  assert.equal(sinceLabel('2026-11-04T09:30:00Z', now), 'for 2 timer siden')
  assert.equal(sinceLabel('2026-11-04T11:15:00Z', now), 'for 45 minutter siden')
  assert.equal(sinceLabel('2026-11-01T12:00:00Z', now), 'for 3 døgn siden')
})

test('sinceLabel says «nå» for under a minute and for a clock ahead of the request', () => {
  assert.equal(sinceLabel('2026-11-04T11:59:30Z', now), 'nå')
  assert.equal(sinceLabel('2026-11-04T12:05:00Z', now), 'nå')
})
