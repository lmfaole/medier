import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { POSTER_PATH, posterPathsIn, tmdbPosterUrl } from './poster-source.ts'

test('a poster path is a plain file under /posters/, and nothing else is one', () => {
  assert.deepEqual(POSTER_PATH.exec('/posters/aB3_-x.jpg')?.slice(1), ['aB3_-x.jpg'])
  for (const path of ['/posters/', '/posters/a/b.jpg', '/posters/../x.jpg', '/posters/x.png', '/covers/x.jpg']) assert.equal(POSTER_PATH.test(path), false, path)
})

test('every distinct poster path in a text is found once, and the source address has the width', () => {
  assert.deepEqual(posterPathsIn(JSON.stringify({ a: '/posters/a.jpg', b: ['/posters/a.jpg', '/posters/b.jpg'], c: '/posters/../x.jpg' })), ['/posters/a.jpg', '/posters/b.jpg'])
  assert.equal(tmdbPosterUrl('a.jpg'), 'https://image.tmdb.org/t/p/w342/a.jpg')
})
