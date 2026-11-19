import assert from 'node:assert/strict'
import { test } from 'node:test'

import { concertAlbumName, concertLabel, playedAt } from './concert-label.ts'

const night = { acts: [{ name: 'Lorde', billing: 'headliner' as const }, { name: 'Khalid', billing: 'support' as const }], artist: null, title: 'Lorde', venue: 'Sentrum Scene', on: '2017-10-18' }
const festival = { acts: [{ name: 'Tove Lo', billing: null }], artist: null, title: 'Slottsfjell 2017', venue: 'Slottsfjellet, Tønsberg', on: '2017-07-13' }

test('a night is titled for its headliners and a festival for its own name', () => {
  assert.equal(concertLabel(night), 'Lorde, Sentrum Scene')
  assert.equal(concertLabel(festival), 'Slottsfjell 2017')
  assert.equal(concertAlbumName(night), 'Konsert: Lorde, Sentrum Scene, 2017')
  assert.equal(concertAlbumName(festival), 'Festival: Slottsfjell 2017')
})

test('an artist played at a concert whatever its billing, case aside', () => {
  assert.equal(playedAt(night, 'khalid'), true)
  assert.equal(playedAt(festival, 'Tove Lo'), true)
  assert.equal(playedAt(night, 'Sigrid'), false)
  assert.equal(playedAt({ acts: [], artist: 'GIMS' }, 'GIMS'), true)
})
