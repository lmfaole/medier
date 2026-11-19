import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { boardgameExtras } from './entity-extras.ts'
import type { ApiResponses } from './server/api.ts'
import type { BoardgameDetails } from './server/details.ts'

const DETAILS: BoardgameDetails = {
  thumbnail: null,
  players: { min: 2, max: 4, best: '3-4', recommended: '2-4' },
  playingTime: { typical: 60, min: null, max: null },
  minAge: 10,
  rating: { average: 7.54, bayes: null, deviation: null, count: 1200 },
  weight: { value: 2.5, count: null },
  ranks: [{ label: 'Brettspill', position: 120 }],
  community: { owned: 5000, trading: null, wanting: null, wishing: null, comments: null },
  votes: [{ players: '3', best: 10, recommended: 5, notRecommended: 1 }],
  designers: [{ name: 'Klaus Teuber', url: 'https://boardgamegeek.com/boardgamedesigner/2' }],
  artists: [], publishers: [], mechanics: [], families: [], expansions: [], implementations: [], integrations: [], compilations: [], contains: [],
  otherNames: [],
}

const page = (details: BoardgameDetails | null): NonNullable<ApiResponses['entity']> => ({
  title: 'Catan', year: null, creator: null, summary: null, cover: null, coverSource: null, banner: null, bannerSource: null, url: null, genres: [], status: 'played', rating: null, owned: false,
  format: null, collection: null, entries: [], achievements: [], rommId: null, logos: {}, facets: { platform: [], mode: [], theme: [], perspective: [], series: [] }, toBeat: null, pages: null, authorCountry: null, profile: [], details,
})

test('what the register says becomes tiles, a register list, a votes table and the ties, as data', () => {
  const extras = boardgameExtras(page(DETAILS))
  assert.deepEqual(extras.tiles?.map((tile) => tile.label), ['Spillere', 'Spilletid', 'Alder', 'Kompleksitet'])
  assert.deepEqual(extras.tiles?.[0], { label: 'Spillere', value: { range: [2, 4], unit: 'spillere' }, note: 'best med 3–4' })
  assert.deepEqual(extras.tiles?.[1]?.value, { range: [60, 60], unit: 'min' })
  assert.deepEqual(extras.facts, [['Anbefalt antall', '2–4']])
  const [register, votes, ties] = extras.sections ?? []
  assert.deepEqual(register?.kind === 'factlist' && register.facts.find(([label]) => label === 'Vurdering'), ['Vurdering', '7,5 av 10'])
  assert.deepEqual(votes?.kind === 'table' && votes.rows, [['3', { n: 10 }, { n: 5 }, { n: 1 }]])
  assert.deepEqual(ties?.kind === 'factlist' && ties.facts.find(([label]) => label === 'Designere'), ['Designere', [{ text: 'Klaus Teuber', href: 'https://boardgamegeek.com/boardgamedesigner/2' }]])
})

test('a game the register has nothing on adds nothing', () => {
  const extras = boardgameExtras(page(null))
  assert.deepEqual(extras.tiles, [])
  assert.deepEqual(extras.sections, [])
})
