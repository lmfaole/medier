import assert from 'node:assert/strict'
import { test } from 'node:test'

import { dated, happened, merged, shelved, timed, TIMELINE_LENGTH, visited } from './timeline.ts'

const seconds = (iso: string) => Date.parse(iso) / 1000

test('the services are merged newest first, a day with no clock after the timed entries of its day', () => {
  const entries = merged(
    timed('music', [{ at: seconds('2026-10-21T13:00:00Z'), title: 'Late song', subtitle: 'Band', image: null }, { at: seconds('2026-10-21T11:30:00Z'), title: 'Early song', subtitle: null, image: null }]),
    dated('film', [{ day: '2026-10-21', title: 'A film', subtitle: '2026', image: null }]),
  )
  assert.deepEqual(entries.map((entry) => entry.title), ['Late song', 'Early song', 'A film'])
})

test('a day is Oslo\'s: a listen after midnight there belongs to the next day, and a shelf line with a moment is timed', () => {
  const entries = merged(
    timed('music', [{ at: seconds('2026-10-20T22:30:00Z'), title: 'After midnight', subtitle: null, image: null }]),
    dated('film', [{ day: '2026-10-20', title: 'A film', subtitle: null, image: null }]),
    shelved('games', [{ day: '2026-10-20', at: seconds('2026-10-20T21:00:00Z'), title: 'Played', subtitle: null, image: null }, { day: '2026-10-20', at: null, title: 'A day', subtitle: null, image: null }]),
  )
  assert.deepEqual(entries.map((entry) => [entry.title, entry.hasTime]), [['After midnight', true], ['Played', true], ['A film', false], ['A day', false]])
})

test('old entries stay: the newest are kept however long ago they were', () => {
  const entries = merged(
    timed('music', [{ at: seconds('2026-09-01T10:30:00Z'), title: 'Weeks ago', subtitle: null, image: null }]),
    dated('tv', [{ day: '2026-10-20', title: 'Yesterday', subtitle: null, image: null }]),
  )
  assert.deepEqual(entries.map((entry) => entry.title), ['Yesterday', 'Weeks ago'])
})

test('the list is cut to its length, the newest kept', () => {
  const songs = Array.from({ length: TIMELINE_LENGTH + 5 }, (_, index) => ({ at: seconds('2026-10-21T13:00:00Z') - index, title: String(index), subtitle: null, image: null }))
  const entries = merged(timed('music', songs))
  assert.equal(entries.length, TIMELINE_LENGTH)
  assert.equal(entries[0]?.title, '0')
})

test('a film visit with a clock is a timed entry at Oslo\'s time, in summer and in winter, and one without is a day only', () => {
  const [summer, winter, bare] = visited('film', [
    { day: '2026-10-31', time: '21:00', title: 'The Ring', subtitle: 'Ringen kino', image: null },
    { day: '2026-11-02', time: '20:15', title: 'Markens grøde', subtitle: null, image: null },
    { day: '2026-11-07', time: null, title: 'Rose', subtitle: null, image: null },
  ])
  assert.deepEqual([summer?.at, winter?.at, bare?.hasTime], ['2026-10-31T20:00:00.000Z', '2026-11-02T19:15:00.000Z', false])
})

test('a picture is the path its own app serves it at, and one that app would not serve is none', () => {
  const pictures = [
    ...timed('music', [{ at: 1, title: 'a', subtitle: null, image: '0221734a-35a8-40f7-b5c5-2f61a200bc7c/123' }, { at: 2, title: 'b', subtitle: null, image: '../x/1' }]),
    ...dated('film', [{ day: '2026-01-01', title: 'c', subtitle: null, image: '/p.jpg' }]),
    ...dated('boardgames', [{ day: '2026-01-01', title: 'd', subtitle: null, image: 'https://cf.geekdo-images.com/x.jpg' }]),
    ...dated('books', [{ day: '2026-01-01', title: 'e', subtitle: null, image: 'https://covers.openlibrary.org/b/id/1-L.jpg' }]),
  ].map((entry) => entry.image)
  assert.deepEqual(pictures.slice(0, 3), ['/apps/medier/musikk/covers/0221734a-35a8-40f7-b5c5-2f61a200bc7c/123-250.jpg', null, '/apps/medier/film/posters/p.jpg'])
  assert.equal(pictures[3], null)
  assert.match(pictures[4] ?? '', /^\/apps\/medier\/boker\/covers\/[a-z0-9-]+\.jpg$/)
})

test('what is still to come is not on the timeline: a visit later today or another day is left out, a day only is there from its day', () => {
  const now = new Date('2026-11-11T10:00:00Z')
  const entries = happened([
    ...visited('film', [
      { day: '2026-11-11', time: '10:00', title: 'Earlier today', subtitle: null, image: null },
      { day: '2026-11-11', time: '17:30', title: 'Tonight', subtitle: null, image: null },
      { day: '2026-11-23', time: '17:30', title: 'Later', subtitle: null, image: null },
    ]),
    ...dated('tv', [{ day: '2026-11-11', title: 'Today', subtitle: null, image: null }, { day: '2026-11-12', title: 'Tomorrow', subtitle: null, image: null }]),
  ], now)
  assert.deepEqual(entries.map((entry) => entry.title), ['Earlier today', 'Today'])
})
