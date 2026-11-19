import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { detailsOf } from './details.ts'

const DETAIL = {
  ext_id: '13', thumbnail: null, min_players: 3, max_players: 4, playing_time: 120, min_playtime: 60, max_playtime: 120, min_age: 10,
  best_players: '4', recommended_players: '3-4', rating_average: 7.1, rating_bayes: 6.9, rating_deviation: 1.5, rating_count: 120000,
  weight: null, weight_count: null, owned_count: null, trading_count: null, wanting_count: null, wishing_count: null, comment_count: null,
}

test('ties are told apart by the register\'s link type and point at the page of their kind', () => {
  const details = detailsOf(DETAIL, [
    { ext_id: '13', kind: 'boardgamedesigner', bgg_id: '2', name: 'Klaus Teuber' },
    { ext_id: '13', kind: 'boardgamemechanic', bgg_id: '7', name: 'Dice Rolling' },
    { ext_id: '13', kind: 'boardgameexpansion', bgg_id: '99', name: 'Seafarers' },
  ], [], [], [])
  assert.deepEqual(details.designers, [{ name: 'Klaus Teuber', url: 'https://boardgamegeek.com/boardgamedesigner/2' }])
  assert.deepEqual(details.mechanics.map((tie) => tie.url), ['https://boardgamegeek.com/boardgamemechanic/7'])
  assert.deepEqual(details.expansions, [{ name: 'Seafarers', url: 'https://boardgamegeek.com/boardgame/99' }])
  assert.deepEqual(details.publishers, [])
})

test('a game nobody has rated or weighed has neither', () => {
  const details = detailsOf({ ...DETAIL, rating_average: null }, [], [], [], [])
  assert.equal(details.rating, null)
  assert.equal(details.weight, null)
})
