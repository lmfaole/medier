import assert from 'node:assert/strict'
import { test } from 'node:test'

import { releaseKindOf } from './release-kind.ts'

test('a release is told by its secondary types, then its primary type', () => {
  assert.equal(releaseKindOf('Album', 'Live,Compilation'), 'Live, Samling, Album')
  assert.equal(releaseKindOf('Single', null), 'Singel')
  assert.equal(releaseKindOf(null, null), null)
  assert.equal(releaseKindOf('Unheard of', null), null)
})
