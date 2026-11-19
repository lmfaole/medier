import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import type { WorkPage } from '../shelf.ts'
import type { ShelfWords } from '../words.ts'
import { toModel } from './entity-model.ts'

const WORDS: ShelfWords = {
  kind: 'game', title: 'Spill', noun: { one: 'spill', many: 'spill' }, lead: '', empty: '', pagesLabel: '', statusLabels: {}, libraryLabels: {},
  creatorLabel: 'Utvikler', amount: { label: 'Timer spilt', unit: 'hours', format: String }, doneDetail: String,
  credit: { name: 'IGDB', href: 'https://www.igdb.com' }, coverRatio: 'poster', itemTitle: 'Spill',
}

const PAGE: WorkPage = {
  title: 'Hades', year: 2020, creator: 'Supergiant', summary: 'Et spill.', cover: '/c.jpg', coverSource: null, banner: null, bannerSource: null, url: 'https://igdb/hades',
  genres: ['Roguelike', 'Action'], status: 'done', rating: 4.5, owned: true, format: 'steam', collection: null, entries: [{ on: '2026-01-01', status: 'done', rating: null, amount: 3, format: null }],
  achievements: [], rommId: null, logos: {}, facets: { platform: ['PC'], mode: [], theme: [], perspective: [], series: [] }, toBeat: null, pages: null, authorCountry: null,
  profile: [{ service: 'pokemongo', key: 'level', label: 'Nivå', value: 53, max: null, history: [] }],
}

test('a work becomes a model: its facts in order, none for what is missing, the log and the achievements last', () => {
  const model = toModel(PAGE, WORDS, () => ({ facts: [['Ekstra', 'x']], sections: [{ id: 'extra', title: 'Ekstra', kind: 'text', lines: ['a'] }] }))
  assert.equal(model.kind, 'game')
  assert.equal(model.kindLabel, undefined)
  assert.deepEqual(model.picture, { cover: '/c.jpg', banner: null, shape: 'poster' })
  assert.deepEqual(model.facts?.filter(([, value]) => value !== null).map(([label]) => label), ['Utgitt', 'Utvikler', 'Sjangre', 'Plattformer', 'Pokémon GO: Nivå', 'Ekstra'])
  assert.deepEqual(model.sections.map((section) => section.id), ['extra', 'log', 'achievements'])
  assert.deepEqual(model.rating, { value: 4.5, scale: 5 })
  assert.deepEqual(model.links?.map((link) => link.href), ['https://igdb/hades', null])
})

test('an app that has another word for its kind overrides the label, and a work with no creator has no logo', () => {
  const model = toModel({ ...PAGE, creator: null, rommId: 7 }, { ...WORDS, itemTitle: 'Dataspill' })
  assert.equal(model.kindLabel, 'Dataspill')
  assert.equal(model.mark, undefined)
  assert.equal(model.links?.[1]?.href, 'https://spill.lmfaole.party/rom/7')
})
