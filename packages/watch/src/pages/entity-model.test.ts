import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { heroOf, mainSections, visibleSections } from '@designsystem/ui/lib/entity-model'

import type { ItemPage, Listing, PersonPage, PlacePage } from '../viewing.ts'
import type { WatchWords } from '../words.ts'
import { toModel, type Hrefs } from './entity-model.ts'

const HREF: Hrefs = { item: (slug) => `/film/${slug}`, person: (slug) => `/person/${slug}`, place: (slug) => `/cinema/${slug}` }
/** A stand-in for the app's words with only what the model reads: the real object comes from the app. */
const WORDS: WatchWords = Object.assign(Object.create(null), {
  title: 'Film', itemKind: 'film', placeKind: 'cinema', noun: { one: 'film', many: 'filmer' }, front: {},
  entity: {
    itemTitle: 'Film',
    lead: (names: string) => `Regissert av ${names}.`,
    placeLead: () => 'Oslo',
    placeTiles: (place: PlacePage) => [{ label: 'Besøk', value: { n: place.visits } }],
    placeFacts: () => [['By', 'Oslo']],
    placeLinks: () => [['Kinoens hjemmeside', null]],
    placeTitle: String,
  },
})

const listing = (slug: string, over: Partial<Listing> = {}): Listing => ({ key: slug, slug, title: slug.toUpperCase(), year: 2001, rating: null, plays: 1, cover: '/c.jpg', ...over })

const ITEM: ItemPage = {
  kind: 'item', slug: 'a', title: 'Alien', year: 1979, originalTitle: null, overview: 'Om rommet.', tagline: 'I rommet', cover: '/c.jpg', backdrop: '/b.jpg',
  facts: [['Spilletid', '2 t']], links: [['IMDb', 'https://imdb/x']],
  lead: [{ name: 'Ridley Scott', slug: 'rs' }], cast: [{ name: 'Sigourney Weaver', slug: 'sw', character: 'Ripley' }], crew: [{ job: 'Writer', people: [{ name: 'Dan', slug: 'dan' }] }],
  seen: [
    { on: '2025-08-02', rating: 4.5, rewatch: false, place: { name: 'Ringen', slug: 'ringen' }, seat: 'Sal 1, rad 10, sete 7,8', episode: null },
    { on: '2025-09-01', rating: null, rewatch: true, place: null, seat: null, episode: null },
  ],
  keywords: ['space', 'horror'], ownership: null, related: [{ title: 'Aliens', year: 1986, slug: 'b', seen: true }, { title: 'Prometheus', year: 2012, slug: null, seen: false }],
  franchise: { name: 'Alien', backdrop: null, seen: 1, total: 2, parts: [{ title: 'Alien', year: 1979, slug: 'a', cover: '/c.jpg', seen: true, current: true }, { title: 'Aliens', year: 1986, slug: 'b', cover: null, seen: false, current: false }] },
}

test('an item: a wide hero, the tagline in italics, and the sections in the order of the page', () => {
  const model = toModel(ITEM, WORDS, HREF)
  assert.equal(model.kind, 'film')
  assert.equal(model.kindLabel, undefined)
  assert.equal(heroOf(model).variant, 'banner')
  assert.deepEqual(model.subtitle, ['1979'])
  assert.deepEqual(model.paragraphs, [{ text: 'I rommet', style: 'italic' }, { text: 'Om rommet.' }, { text: 'space, horror', lang: 'en' }])
  assert.deepEqual(model.rating, { value: 4.5, scale: 5 })
  assert.deepEqual(model.notice, { kind: 'tmdb' })
  assert.deepEqual(model.sections.map((section) => section.id), ['lead', 'cast', 'crew', 'log', 'how-seen-0', 'franchise', 'related'])
  assert.deepEqual(model.sections.find((section) => section.id === 'lead'), { id: 'lead', title: 'Regissert', kind: 'text', lines: [{ text: 'Ridley Scott', href: '/person/rs' }] })
})

test('the main column reads the owner\'s data first, then the people, then the franchise; the cast is rows with the role as detail', () => {
  const model = toModel(ITEM, WORDS, HREF)
  assert.deepEqual(mainSections(model.sections).map((section) => section.id), ['log', 'how-seen-0', 'lead', 'cast', 'crew', 'franchise', 'related'])
  const cast = model.sections.find((section) => section.id === 'cast')
  assert.ok(cast?.kind === 'rows')
  assert.ok(cast.rows.every((row) => typeof row.name === 'object' && row.name.href !== undefined))
})

test('the numbers of an item are tiles: how often, first and last, where, and the register\'s running time; none of them is a row of the about', () => {
  const model = toModel({ ...ITEM, facts: [['Spilletid', '2 t'], ['Land', 'USA']] }, WORDS, HREF)
  assert.deepEqual(model.tiles, [
    { label: 'Visninger', value: { n: 2 } },
    { label: 'Første', value: { day: '2025-08-02' } },
    { label: 'Sist', value: { day: '2025-09-01' } },
    { label: 'Sett på', value: { words: 'Ringen' }, href: '/cinema/ringen' },
    { label: 'Spilletid', value: { words: '2 t' } },
  ])
  assert.deepEqual(model.facts, [['Land', 'USA']])
  assert.deepEqual(toModel({ ...ITEM, seen: [] }, WORDS, HREF).tiles, [{ label: 'Spilletid', value: { words: '2 t' } }])
})

test('the log says where it was seen, and a cinema visit is a list of facts with the company counted from the seats', () => {
  const sections = toModel(ITEM, WORDS, HREF).sections
  const log = sections.find((section) => section.kind === 'log')
  assert.ok(log?.kind === 'log')
  assert.equal(log.entries.length, 2)
  const how = sections.find((section) => section.id === 'how-seen-0')
  assert.ok(how?.kind === 'factlist')
  assert.deepEqual(how.facts.filter(([, value]) => value !== null).map(([label, value]) => [label, value]), [['Kino', { text: 'Ringen', href: '/cinema/ringen' }], ['Sal', 'Sal 1'], ['Rad', '10'], ['Seter', '7,8'], ['Billetter', '2'], ['Følge', 'Sammen med 1 annen']])
})

test('the franchise and the recommendations are rows: the current part is no link, the seen ones say so', () => {
  const sections = toModel(ITEM, WORDS, HREF).sections
  const franchise = sections.find((section) => section.id === 'franchise')
  assert.ok(franchise?.kind === 'rows')
  assert.equal(franchise.note, 'Del av Alien: 1 av 2 sett.')
  assert.deepEqual(franchise.rows.map((row) => [row.name, row.seen, row.current]), [['Alien (1979)', true, true], [{ text: 'Aliens (1986)', href: '/film/b' }, false, false]])
  const related = sections.find((section) => section.id === 'related')
  assert.ok(related?.kind === 'rows')
  assert.deepEqual(related.rows.map((row) => row.name), [{ text: 'Aliens (1986)', href: '/film/b' }, 'Prometheus (2012)'])
})

test('an item with nothing but a title has no sections left to show, and a short log is no section', () => {
  const bare: ItemPage = { ...ITEM, tagline: null, overview: null, keywords: [], lead: [], cast: [], crew: [], seen: [], related: [], franchise: null, facts: [], links: [], backdrop: null }
  const model = toModel(bare, WORDS, HREF)
  assert.deepEqual(visibleSections(model.sections).map((section) => section.id), [])
  assert.equal(heroOf(model).variant, 'cover')
})

test('a series is a tv model with its own word only where the app has one', () => {
  const tvWords: WatchWords = Object.assign(Object.create(null), { ...WORDS, itemKind: 'serie', entity: { ...WORDS.entity, itemTitle: 'TV-serie' } })
  const tv = toModel(ITEM, tvWords, HREF)
  assert.equal(tv.kind, 'tv')
  assert.equal(tv.kindLabel, 'TV-serie')
})

const PERSON: PersonPage = {
  kind: 'person', slug: 'p', name: 'Ripley', lead: [listing('a', { rating: 4, plays: 2 })], acted: [listing('b')], crewed: [{ job: 'Writer', works: [listing('a')] }, { job: 'Gaffer', works: [listing('c')] }],
  tmdbId: 7, born: '1949-10-08', died: null, placeOfBirth: 'New York', department: 'Acting', biography: 'Skuespiller.', biographyLanguage: 'en', imdbId: null,
}

test('a person: a name alone, the biography in its language, the count of works seen once each, and a group for each job', () => {
  const model = toModel(PERSON, WORDS, HREF)
  assert.equal(heroOf(model).variant, 'name')
  assert.deepEqual(model.subtitle, ['Skuespill'])
  assert.deepEqual(model.paragraphs, [{ text: 'Skuespiller.', lang: 'en' }])
  assert.deepEqual(model.facts, [['Født', '8. oktober 1949, New York'], ['Død', null]])
  assert.deepEqual(model.links, [{ label: 'IMDb', href: null }, { label: 'TMDB', href: 'https://www.themoviedb.org/person/7' }])
  assert.deepEqual(model.sections.map((section) => [section.id, section.title]), [['lead', 'Regissert'], ['acted', 'På rollelisten'], ['crewed-0', 'Manus'], ['crewed-1', 'Gaffer']])
  assert.deepEqual(model.tiles, [{ label: 'Filmer sett', value: { n: 3 } }])
  const lead = model.sections[0]
  assert.ok(lead?.kind === 'rows')
  assert.deepEqual(lead.rows[0], { name: { text: 'A', href: '/film/a' }, picture: '/c.jpg', detail: '2001', count: [{ words: '4 av 5' }, { times: 2 }] })
  assert.deepEqual(visibleSections(toModel({ ...PERSON, lead: [] }, WORDS, HREF).sections).map((section) => section.id), ['acted', 'crewed-0', 'crewed-1'])
})

const PLACE: PlacePage = { kind: 'place', slug: 'r', name: 'Ringen', owner: null, city: 'Oslo', country: null, website: null, image: '/p.jpg', visits: 4, first: null, last: null, works: [listing('a')], halls: [] }

test('a place: one section for each hall, or one «seen here» where no visit names a hall', () => {
  assert.deepEqual(toModel(PLACE, WORDS, HREF).sections.map((section) => section.id), ['seen-here'])
  assert.deepEqual(toModel(PLACE, WORDS, HREF).tiles, [{ label: 'Besøk', value: { n: 4 } }, { label: 'Filmer', value: { n: 1 } }])
  assert.equal(heroOf(toModel(PLACE, WORDS, HREF)).variant, 'banner')
  const halls = toModel({ ...PLACE, halls: [{ name: 'Sal 1', visits: 3, works: [listing('a')] }, { name: null, visits: 1, works: [listing('b')] }] }, WORDS, HREF)
  assert.deepEqual(halls.sections.map((section) => [section.id, section.title, section.note]), [['hall-0', 'Sal 1', '3 besøk'], ['hall-1', 'Sal ikke oppgitt', '1 besøk']])
  assert.deepEqual(halls.notice, { kind: 'tmdb' })
})
