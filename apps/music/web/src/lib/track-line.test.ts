import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { albumLength, formatTrackLength, trackInfo, trackNumber } from './track-line.ts'
import type { AlbumTrack } from './types.ts'

const track = (rest: Partial<AlbumTrack> = {}): AlbumTrack => ({ track: 'One', plays: 1, loved: false, genres: [], ...rest })

test('a track length is minutes and zero-padded seconds', () => {
  assert.equal(formatTrackLength(201_000), '3:21')
  assert.equal(formatTrackLength(60_000), '1:00')
  assert.equal(formatTrackLength(59_600), '1:00')
})

test('the album length adds the lengths that are known and says when some are not', () => {
  assert.equal(albumLength([track()]), null)
  assert.deepEqual(albumLength([track({ lengthMs: 1_800_000 }), track({ lengthMs: 1_200_000 })]), { text: '50 min', complete: true })
  assert.equal(albumLength([track({ lengthMs: 60_000 }), track()])?.complete, false)
})

test('a track is numbered by its disc only when the album has several', () => {
  assert.equal(trackNumber(track({ disc: 2, position: 3 }), false), '3')
  assert.equal(trackNumber(track({ disc: 2, position: 3 }), true), '2-3')
  assert.equal(trackNumber(track(), true), null)
})

test('a track lists only what is known of it, in reading order', () => {
  assert.deepEqual(trackInfo(track(), false), [])
  const facts = trackInfo(track({ position: 1, lengthMs: 201_000, credit: 'Band feat. Guest', genres: ['pop', 'rnb'], releaseYear: 2019, firstAt: 1_536_307_756, lastAt: 1_778_939_919, loved: true }), false)
  assert.deepEqual(
    facts.map(([label]) => label),
    ['Nummer', 'Lengde', 'Kreditt', 'Sjangre', 'Utgitt', 'Første gang spilt', 'Sist spilt', 'Elsket'],
  )
  assert.deepEqual(facts.slice(0, 5).map(([, value]) => value), ['1', '3:21', 'Band feat. Guest', 'pop, rnb', '2019'])
})
