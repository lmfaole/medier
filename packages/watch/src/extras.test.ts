import assert from 'node:assert/strict'
import { test } from 'node:test'

import { knownOf } from './api.ts'
import { franchiseOfWork, NO_EXTRAS, relatedWorks, type WatchExtras } from './extras.ts'

const extras: WatchExtras = {
  related: new Map([[1, [{ related_id: 2, title: 'Heat 2', day: '2027-01-01', position: 0 }, { related_id: 9, title: 'Other', day: null, position: 1 }]]]),
  franchiseOf: new Map([[1, 5], [2, 5], [7, 6]]),
  franchises: new Map([
    [5, { name: 'Heat', backdropPath: '/heat.jpg', parts: [{ tmdb_id: 1, title: 'Heat', day: '1995-12-15', poster_path: '/h1.jpg', backdrop_path: null, position: 0 }, { tmdb_id: 2, title: 'Heat 2', day: '2027-01-01', poster_path: null, backdrop_path: null, position: 1 }] }],
    [6, { name: 'Alone', backdropPath: null, parts: [{ tmdb_id: 7, title: 'Alone', day: null, poster_path: null, backdrop_path: null, position: 0 }] }],
    [8, { name: 'Finished', backdropPath: null, parts: [{ tmdb_id: 11, title: 'A', day: null, poster_path: null, backdrop_path: null, position: 0 }, { tmdb_id: 12, title: 'B', day: null, poster_path: null, backdrop_path: null, position: 1 }] }],
    [9, { name: 'Unseen', backdropPath: null, parts: [{ tmdb_id: 21, title: 'C', day: null, poster_path: null, backdrop_path: null, position: 0 }, { tmdb_id: 22, title: 'D', day: null, poster_path: null, backdrop_path: null, position: 1 }] }],
  ]),
}
const known = { slugs: new Map([[1, 'heat'], [2, 'heat-2'], [11, 'a'], [12, 'b']]), seen: new Set([1, 11, 12]) }

test('the recommendations say whether each was seen and where its page is, and a work with none has none', () => {
  assert.deepEqual(relatedWorks(1, extras, known), [
    { title: 'Heat 2', year: 2027, slug: 'heat-2', seen: false },
    { title: 'Other', year: null, slug: null, seen: false },
  ])
  assert.deepEqual(relatedWorks(3, extras, known), [])
  assert.deepEqual(relatedWorks(1, NO_EXTRAS, known), [])
})

test('a work shows its franchise with its own part marked and how much was seen; a franchise of one part is not shown', () => {
  const shelf = franchiseOfWork(1, extras, known)
  assert.deepEqual([shelf?.name, shelf?.seen, shelf?.total], ['Heat', 1, 2])
  assert.deepEqual(shelf?.parts.map((part) => [part.title, part.current, part.seen, part.slug, part.cover]), [['Heat', true, true, 'heat', '/posters/h1.jpg'], ['Heat 2', false, false, 'heat-2', null]])
  assert.equal(shelf?.backdrop, '/backdrops/heat.jpg')
  assert.equal(franchiseOfWork(7, extras, known), null)
  assert.equal(franchiseOfWork(99, extras, known), null)
})

test('a work the log names is seen even with no day, and a collection line has a page but is not seen', () => {
  const slugOf = (key: string): string => `slug-${key}`
  const viewing = { id: 1, on: null, title: 'Heat', year: 1995, rating: null, rewatch: false, tmdbId: 1, item: null, place: null, episode: null }
  const line = { title: 'Wanted', year: 2000, tmdbId: 2, item: null, status: 'want' as const, rating: null, addedOn: null, format: null }
  const owned = knownOf(slugOf, [viewing], [line])
  assert.deepEqual([...owned.seen], [1])
  assert.equal(owned.slugs.size, 2)
})

test("a franchise with no picture of its own borrows the wide picture of its newest part that has one", () => {
  const parts = [{ tmdb_id: 1, title: 'A', day: '2000-01-01', poster_path: null, backdrop_path: '/a.jpg', position: 0 }, { tmdb_id: 2, title: 'B', day: '2010-01-01', poster_path: null, backdrop_path: '/b.jpg', position: 1 }, { tmdb_id: 3, title: 'C', day: null, poster_path: null, backdrop_path: null, position: 2 }]
  const borrowed: WatchExtras = { related: new Map(), franchiseOf: new Map([[1, 9], [2, 8]]), franchises: new Map([[9, { name: 'Borrowed', backdropPath: null, parts }], [8, { name: 'Own', backdropPath: '/own.jpg', parts }]]) }
  assert.equal(franchiseOfWork(1, borrowed, { slugs: new Map(), seen: new Set([1]) })?.backdrop, '/backdrops/b.jpg')
  assert.equal(franchiseOfWork(2, borrowed, { slugs: new Map(), seen: new Set([1]) })?.backdrop, '/backdrops/own.jpg')
})
