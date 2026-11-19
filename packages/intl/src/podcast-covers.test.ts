import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { SHOW_COVER_PATH, showCoverPathOf, showCoverSourceOf } from './podcast-covers.ts'

test('a picture is kept only from a feed host, as a small version, under a path of its own', () => {
  const apple = 'https://is1-ssl.mzstatic.com/image/thumb/Podcasts/v4/ab/cd/600x600bb.jpg'
  assert.match(showCoverPathOf(apple) ?? '', SHOW_COVER_PATH)
  assert.equal(showCoverSourceOf(apple), 'https://is1-ssl.mzstatic.com/image/thumb/Podcasts/v4/ab/cd/300x300bb.jpg')
  assert.equal(showCoverPathOf('https://example.com/a.jpg'), null)
  assert.equal(showCoverSourceOf('http://is1-ssl.mzstatic.com/a.jpg'), null)
  assert.equal(showCoverPathOf(null), null)
})
