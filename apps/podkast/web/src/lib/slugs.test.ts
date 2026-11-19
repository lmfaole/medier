import assert from 'node:assert/strict'
import { test } from 'node:test'

import { episodeKey, slugsMentioned, type IndexedEntity } from './slugs.ts'

const index: IndexedEntity[] = [
  { kind: 'show', slug: 'a-1', name: 'Alpha', show: null },
  { kind: 'show', slug: 'b-2', name: 'Beta', show: null },
  { kind: 'episode', slug: 'e-3', name: 'Pilot', show: 'Alpha' },
  { kind: 'episode', slug: 'e-4', name: 'Pilot', show: 'Beta' },
]

test('only the shows and episodes the data names get a slug', () => {
  const slugs = slugsMentioned(index, { recent: [{ show: 'Alpha', episode: 'Pilot' }], total: 3 })
  assert.deepEqual(slugs.shows, { Alpha: 'a-1' })
  assert.deepEqual(slugs.episodes, { [episodeKey('Alpha', 'Pilot')]: 'e-3' })
})

test('an episode title alone does not link an episode of a show the data does not name', () => {
  const slugs = slugsMentioned(index, [{ name: 'Pilot' }])
  assert.deepEqual(slugs, { shows: {}, episodes: {} })
})
