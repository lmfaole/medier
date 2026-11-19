import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import type { EntityData } from '@/server/page-data'
import { mainSections } from '@designsystem/ui/lib/entity-model'
import { toModel } from './entity-model.ts'

type Show = Extract<EntityData, { kind: 'show' }>
type Episode = Extract<EntityData, { kind: 'episode' }>

const TOTALS = { plays: 4, minutes: 0, shows: 1, episodes: 3, firstAt: 1566400000, lastAt: null }
const SHOW: Show = {
  kind: 'show', slug: 's', name: '99% Invisible', totals: TOTALS, years: [{ year: 2019, plays: 4 }], cover: '/c.jpg',
  topEpisodes: [{ name: 'Peace Lines', slug: 'peace-lines', plays: 2 }],
  about: { title: 'x', author: 'A', owner: null, language: 'en-US', country: 'USA', genre: null, description: 'Design.', website: 'https://example.org', appleUrl: null, feedUrl: null, people: [{ name: 'Roman', role: 'Vert', href: null }] },
}

test('a show is a square cover, tiles that leave out what is not known, a chart, its top episodes as links and its people', () => {
  const model = toModel(SHOW)
  assert.deepEqual(model.tiles, [{ label: 'Avspillinger', value: { n: 4 } }, { label: 'Første', value: { ts: 1566400000 } }])
  assert.deepEqual(model.picture, { cover: '/c.jpg', shape: 'square' })
  assert.deepEqual(model.facts?.[0], ['Utgiver', 'A'])
  assert.deepEqual(model.facts?.[1], ['Land', 'USA'])
  assert.deepEqual(model.links?.filter((link) => link.href !== null).map((link) => link.label), ['Nettside'])
  const rows = model.sections.find((section) => section.kind === 'rows')
  assert.equal(rows?.kind === 'rows' && rows.rows[0]?.count && 'times' in rows.rows[0].count && rows.rows[0].count.times, 2)
  assert.equal(rows?.note, 'Du hørte 3 episoder.')
  assert.deepEqual(model.sections.map((section) => section.id), ['years', 'top-episodes', 'people'])
  assert.deepEqual(mainSections(model.sections).map((section) => section.id), ['years', 'top-episodes', 'people'])
  const people = model.sections.find((section) => section.id === 'people')
  assert.ok(people?.kind === 'rows', 'people are rows (a name and its role as detail), not a wide table')
})

test('an episode names its show as a link and lists when it was heard', () => {
  const episode: Episode = { kind: 'episode', slug: 'e', name: 'Ep', show: { name: '99% Invisible', slug: 's' }, totals: TOTALS, listens: [1566400000], cover: null, about: { description: null, publishedAt: null, durationSeconds: 3723, link: null, season: 4, episode: 55, people: [] } }
  const model = toModel(episode)
  assert.deepEqual(model.subtitle, [{ text: '99% Invisible', href: '/show/s' }])
  assert.deepEqual(model.facts, [['Utgitt', null], ['Varighet', '1 t 2 min'], ['Sesong', 'Sesong 4, episode 55']])
  assert.deepEqual(model.sections[0], { id: 'listens', title: 'Avspillinger', band: 'mine', kind: 'text', lines: [] })
})
