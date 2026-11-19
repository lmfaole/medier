import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { bandOf, mainBlocks, tilesOf, foldGroups, foldIsOpen, formatAmount, formatNum, hasRail, heroOf, isNum, mainSections, mapSections, kickerOf, rowInfo, starsOf, visibleFacts, visibleSections, type EntityModel, type Section } from './entity-model.ts'

const model = (over: Partial<EntityModel> = {}): EntityModel => ({ kind: 'book', name: 'Bok', sections: [], ...over })

test('the hero follows the picture: a cover with a shape stays whole, a banner alone is wide, nothing is the name', () => {
  assert.deepEqual(heroOf(model({ picture: { cover: '/a.jpg' } })), { variant: 'cover', shape: 'poster', cover: '/a.jpg', banner: null })
  assert.deepEqual(heroOf(model({ picture: { cover: '/a.jpg', shape: 'square' } })), { variant: 'cover', shape: 'square', cover: '/a.jpg', banner: null })
  assert.equal(heroOf(model({ picture: { cover: '/a.jpg', banner: '/b.jpg', shape: 'poster' } })).variant, 'cover')
  assert.deepEqual(heroOf(model({ picture: { cover: '/a.jpg', banner: '/b.jpg' } })), { variant: 'banner', picture: '/b.jpg' })
  assert.deepEqual(heroOf(model({ picture: { cover: null, banner: null } })), { variant: 'name' })
  assert.deepEqual(heroOf(model()), { variant: 'name' })
})

test('the kicker is the kind\'s word unless the app has another', () => {
  assert.equal(kickerOf(model({ kind: 'boardgame' })), 'Brettspill')
  assert.equal(kickerOf(model({ kind: 'show', kindLabel: 'Podkast' })), 'Podkast')
})

test('a figure is written by its kind', () => {
  assert.equal(formatNum({ n: 1234 }), '1 234')
  assert.equal(formatNum({ times: 2 }), '2×')
  assert.equal(formatNum({ minutes: 165 }), '2 t 45 min')
  assert.equal(formatNum({ day: '2025-08-02' }), '2. august 2025')
  assert.equal(formatNum({ range: [2, 4], unit: 'spillere' }), '2–4 spillere')
  assert.equal(formatNum({ range: [3, 3], unit: 'min' }), '3 min')
  assert.equal(formatNum({ range: [3, null], unit: 'min' }), '3 min')
  assert.equal(formatNum({ words: '8+' }), '8+')
  assert.ok(isNum({ n: 1 }) && !isNum({ text: 'a', href: '/x' }) && !isNum(['a']))
})

test('an amount is written in the unit of the app', () => {
  assert.equal(formatAmount('hours', 0.5), '30 min')
  assert.equal(formatAmount('hours', 6), '6 t')
  assert.equal(formatAmount('pages', 300), '300 s')
  assert.equal(formatAmount('plays', 1), '1 parti')
})

test('a rating out of ten is five stars and keeps its exact value as the label', () => {
  assert.deepEqual(starsOf({ value: 7.5, scale: 10 }), { stars: 3.75, label: 'Vurdering 7,5 av 10' })
  assert.deepEqual(starsOf({ value: 4, scale: 5, label: 'Din vurdering' }), { stars: 4, label: 'Din vurdering 4 av 5' })
})

test('facts with nothing to say are dropped, a list of texts counts as one value', () => {
  const facts = visibleFacts([['A', null], ['B', ''], ['C', []], ['D', ['x', { text: 'y' }]], ['E', { text: 'z', href: '/z' }]])
  assert.deepEqual(facts.map(([label]) => label), ['D', 'E'])
})

test('an empty section is hidden, and a log is a section only where it is a chart of three days or more', () => {
  const sections: Section[] = [
    { id: 'a', title: 'A', kind: 'rows', rows: [] },
    { id: 'b', title: 'B', kind: 'factlist', facts: [['x', null]] },
    { id: 'c', title: 'C', kind: 'chart', series: [], valueLabel: 'v' },
    { id: 'd', title: 'D', kind: 'log', entries: [{ on: '2025-01-01', amount: null }, { on: '2025-01-02', amount: null }], noun: { one: 'linje', many: 'linjer' } },
    { id: 'd3', title: 'D', kind: 'log', entries: [{ on: '2025-01-01', amount: null }, { on: '2025-01-03', amount: null }], noun: { one: 'linje', many: 'linjer' } },
    { id: 'e', title: 'E', kind: 'achievements', achievements: [] },
    { id: 'f', title: 'F', kind: 'table', rows: [['a', { n: 1 }]] },
  ]
  assert.deepEqual(visibleSections(sections).map((section) => section.id), ['d3', 'f'])
})

const at = (id: string, kind: 'rows' | 'chart' | 'achievements' | 'log' | 'factlist' | 'map' | 'text', band?: 'mine' | 'about'): Section => {
  const base = { id, title: id, ...(band === undefined ? {} : { band }) }
  switch (kind) {
    case 'rows': return { ...base, kind, rows: [{ name: 'x' }] }
    case 'chart': return { ...base, kind, series: [{ label: '1', value: 2 }], valueLabel: '' }
    case 'achievements': return { ...base, kind, achievements: [{ service: 'steam', title: 't', description: null, icon: null, points: null, rarity: null, unlockedAt: null, progress: null, target: null, tier: null, tiers: null }] }
    case 'log': return { ...base, kind, entries: [{ on: '2025-01-01', amount: null }, { on: '2025-01-05', amount: null }], noun: { one: 'a', many: 'b' } }
    case 'factlist': return { ...base, kind, facts: [['a', 'b']] }
    case 'map': return { ...base, kind, src: '/m.png', link: 'k', credit: 'c' }
    case 'text': return { ...base, kind, lines: ['a'] }
  }
}

test('a section is the owner\'s (mine) or the thing\'s (about): by what it says, else by its kind', () => {
  assert.deepEqual([at('a', 'log'), at('a', 'chart'), at('a', 'achievements'), at('a', 'rows'), at('a', 'factlist'), at('a', 'text')].map(bandOf), ['mine', 'mine', 'mine', 'about', 'about', 'about'])
  assert.equal(bandOf(at('a', 'factlist', 'mine')), 'mine')
  assert.equal(bandOf(at('a', 'chart', 'about')), 'about')
})

test('the main column has one order for every kind: mine before about, each in the model\'s order, the map not among them', () => {
  const sections = [at('lead', 'text'), at('cast', 'rows'), at('log', 'log'), at('map', 'map'), at('how', 'factlist', 'mine'), at('related', 'rows'), at('years', 'chart')]
  assert.deepEqual(mainSections(sections).map((section) => section.id), ['log', 'how', 'years', 'lead', 'cast', 'related'])
  assert.deepEqual(mapSections(sections).map((section) => section.id), ['map'])
})

test('a page with nothing to say beside its sections has no rail; a map or any word of it makes one', () => {
  assert.equal(hasRail(model({ sections: [at('a', 'rows')] })), false)
  assert.equal(hasRail(model({ subtitle: ['2002'] })), true)
  assert.equal(hasRail(model({ facts: [['a', null]] })), false)
  assert.equal(hasRail(model({ facts: [['a', 'b']] })), true)
  assert.equal(hasRail(model({ facts: [['a', 'b']], picture: { cover: '/a.jpg' } })), false)
  assert.equal(hasRail(model({ links: [{ label: 'x', href: null }] })), false)
  assert.equal(hasRail(model({ sections: [at('m', 'map')] })), true)
})

test('the new sections are shown by what they hold', () => {
  const sections: Section[] = [
    { id: 'g0', title: 'G', kind: 'gallery', items: [] },
    { id: 'g1', title: 'G', kind: 'gallery', items: [{ name: 'a', href: null, cover: null, ratio: 'square' }] },
    { id: 'p0', title: 'P', kind: 'photos', photos: [], href: '/x' },
    { id: 'p1', title: 'P', kind: 'photos', photos: [{ url: '/a.jpg', video: false }], href: '/x' },
    { id: 'm0', title: 'M', kind: 'map', src: '', link: 'k', credit: 'c' },
    { id: 'm1', title: 'M', kind: 'map', src: '/m.png', link: 'k', credit: 'c' },
    { id: 'f0', title: 'F', kind: 'fold', groups: [{ summary: 'a', items: [] }] },
    { id: 'f1', title: 'F', kind: 'fold', groups: [{ summary: 'a', items: ['x'] }] },
    { id: 's0', title: 'S', kind: 'chart', series: [{ label: '1', value: 0 }], valueLabel: 'v', stacked: { data: [{ label: '1', series: 'a', value: 0 }], series: ['a'] } },
    { id: 's1', title: 'S', kind: 'chart', series: [], valueLabel: 'v', stacked: { data: [{ label: '1', series: 'a', value: 3 }], series: ['a'] } },
  ]
  assert.deepEqual(visibleSections(sections).map((section) => section.id), ['g1', 'p1', 'm1', 'f1', 's1'])
})

test('a fold is open while it has fewer groups than openBelow', () => {
  const groups = [{ summary: 'a', items: ['x'] }, { summary: 'b', items: ['y'] }]
  assert.equal(foldIsOpen({ groups, openBelow: 3 }), true)
  assert.equal(foldIsOpen({ groups, openBelow: 2 }), false)
  assert.equal(foldIsOpen({ groups }), false)
  assert.equal(foldGroups({ groups: [...groups, { summary: 'c', items: [] }] }).length, 2)
  })

test('a row\'s info is its facts that say something', () => {
  assert.deepEqual(rowInfo({ name: 'x', info: [['Nummer', '3'], ['Kreditt', null]] }), [['Nummer', '3']])
  assert.deepEqual(rowInfo({ name: 'x' }), [])
})

const short = (id: string, count: number, band?: 'mine' | 'about'): Section => ({ id, title: id, ...(band === undefined ? {} : { band }), kind: 'factlist', facts: Array.from({ length: count }, (_, index): [string, string] => [`k${index}`, 'v']) })

test('two consecutive short fact sections of one band are a pair; a long, unlike or other-band one is alone', () => {
  assert.deepEqual(mainBlocks([short('a', 5), short('b', 6), short('c', 3)]).map((block) => block.map((section) => section.id)), [['a', 'b'], ['c']])
  assert.deepEqual(mainBlocks([short('a', 9), short('b', 9)]).map((block) => block.length), [1, 1])
  assert.deepEqual(mainBlocks([short('a', 2), short('b', 8)]).map((block) => block.length), [1, 1])
  assert.deepEqual(mainBlocks([short('a', 4, 'mine'), short('b', 4)]).map((block) => block.length), [1, 1])
  assert.deepEqual(mainBlocks([at('r', 'rows'), short('a', 4), short('b', 4)]).map((block) => block.length), [1, 2])
})

test('the owner\'s copy is the last tile, «Eier», and never a part of the rail', () => {
  const owned = model({ tiles: [{ label: 'Visninger', value: { n: 2 } }], ownership: { status: 'owned', format: 'cd', lines: [{ status: 'owned', format: 'cd', addedOn: null, rating: null }] } })
  assert.deepEqual(tilesOf(owned).map((tile) => tile.label), ['Visninger', 'Eier'])
  assert.equal(hasRail(owned), false)
})
