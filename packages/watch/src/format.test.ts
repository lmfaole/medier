import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { episodeLabel } from './format.ts'

test('an episode is named as far as the log knows it, and a film has none', () => {
  assert.deepEqual(
    [null, { season: 2, episode: 5 }, { season: 2, episode: null }, { season: null, episode: 5 }, { season: null, episode: null }].map(episodeLabel),
    ['', 'sesong 2, episode 5', 'sesong 2', 'episode 5', ''],
  )
})

test('a seat is taken apart into hall, row and seats, and counts the tickets', async () => {
  const { seatParts, companyLabel } = await import('./format.ts')
  assert.deepEqual(seatParts('Sal 1, rad 10, sete 7'), { hall: 'Sal 1', row: '10', seats: '7', tickets: 1 })
  assert.deepEqual(seatParts('Supreme 1 by DNB, rad 7, sete 6, 5, 4'), { hall: 'Supreme 1 by DNB', row: '7', seats: '6, 5, 4', tickets: 3 })
  assert.equal(seatParts('Sal 1, rad 4, 11, sete 24, 23, 11')?.row, '4, 11')
  assert.equal(seatParts('hmm'), null)
  assert.deepEqual([companyLabel(1), companyLabel(2), companyLabel(3)], ['Alene', 'Sammen med 1 annen', 'Sammen med 2 andre'])
})

test('a seat without row and seat is a hall and a count of tickets', async () => {
  const { seatParts } = await import('./format.ts')
  assert.deepEqual(seatParts('Vega kino tre, 2 billetter'), { hall: 'Vega kino tre', row: null, seats: null, tickets: 2 })
  assert.equal(seatParts('Sal 3, 1 billett')?.tickets, 1)
})
