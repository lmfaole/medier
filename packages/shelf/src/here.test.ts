import assert from 'node:assert/strict'
import { test } from 'node:test'

import { hereOf } from './here.ts'

test('the base is taken off the path and the front page is the root', () => {
  assert.deepEqual(hereOf(new URL('https://x.test/apps/spill/historikk?month=2024-05'), '/apps/spill/'), { path: '/historikk', search: { month: '2024-05' } })
  assert.equal(hereOf(new URL('https://x.test/apps/spill/'), '/apps/spill/').path, '/')
  assert.equal(hereOf(new URL('https://x.test/apps/spill'), '/apps/spill/').path, '/')
})

test('a path that only starts like the base is left as it is', () => {
  assert.equal(hereOf(new URL('https://x.test/apps/spillet/a'), '/apps/spill/').path, '/apps/spillet/a')
})

test('the card is not part of where the page stands', () => {
  assert.deepEqual(hereOf(new URL('https://x.test/bibliotek?q=a&kort=game.zelda'), '/').search, { q: 'a' })
})
