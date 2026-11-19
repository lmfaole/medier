import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { archiveThumbnailUrl, COVER_PATH, coverPathsIn } from './cover-archive.ts'

const RELEASE = 'f1418001-7f1e-46af-bfdb-95faeded8841'

test('a cover path has the release, the image and the size, and nothing else under /covers/ is one', () => {
  assert.deepEqual(COVER_PATH.exec(`/covers/${RELEASE}/32916450708-250.jpg`)?.slice(1), [RELEASE, '32916450708', '250'])
  for (const path of ['/covers/', '/covers/not-a-uuid/1-250.jpg', `/covers/${RELEASE}/1-1200.jpg`, `/covers/${RELEASE}/../x-250.jpg`]) {
    assert.equal(COVER_PATH.test(path), false, path)
  }
})

test('every distinct cover path in a text is found once', () => {
  const text = JSON.stringify({ a: `/covers/${RELEASE}/1-250.jpg`, b: [`/covers/${RELEASE}/1-250.jpg`, `/covers/${RELEASE}/2-250.jpg`], c: '/covers/x/3-250.jpg' })
  assert.deepEqual(coverPathsIn(text), [`/covers/${RELEASE}/1-250.jpg`, `/covers/${RELEASE}/2-250.jpg`])
})

test('the archive thumbnail skips the redirect of coverartarchive.org', () => {
  assert.equal(archiveThumbnailUrl(RELEASE, '5'), `https://archive.org/download/mbid-${RELEASE}/mbid-${RELEASE}-5_thumb250.jpg`)
})
