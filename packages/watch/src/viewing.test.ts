import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { excerpt, itemKey, posterUrl, watchCore, type Credit, type WatchConfig, type WatchItem, type WatchPlace, type WatchViewing } from './viewing.ts'

const CINEMA_CONFIG: WatchConfig<'film', 'cinema'> = {
  noun: { one: 'film', many: 'filmer' },
  itemKind: 'film',
  placeKind: 'cinema',
  leadJob: 'Director',
  crewJobs: ['Writer', 'Cinematography', 'Composer', 'Editor', 'Producer'],
}

const core = watchCore(CINEMA_CONFIG)

const credit = (id: number, name: string, job: string, character: string | null = null): Credit => ({ id, name, job, character })
const info = (tmdbId: number, title: string, year: number, more: Partial<WatchItem> = {}): WatchItem => ({ tmdbId, title, year, runtimeMinutes: 100, posterPath: null, backdropPath: null, languages: [], genres: ['Krim'], countries: ['USA'], credits: [], ...more })

const heat = info(949, 'Heat', 1995, {
  runtimeMinutes: 170,
  posterPath: '/p.jpg',
  credits: [credit(1100, 'Michael Mann', 'Director'), credit(1158, 'Al Pacino', 'Cast', 'Hanna'), credit(380, 'Robert De Niro', 'Cast', 'McCauley'), credit(1100, 'Michael Mann', 'Writer'), credit(7, 'Elliot Goldenthal', 'Composer')],
})
const collateral = info(1, 'Collateral', 2004, { credits: [credit(1100, 'Michael Mann', 'Director'), credit(380, 'Robert De Niro', 'Cast')], genres: ['Thriller'] })
const hunger = info(4, 'Sult', 2008, { genres: ['Drama'], countries: ['Storbritannia'] })

let id = 0
const viewing = (on: string | null, item: WatchItem | null, rating: number | null = null, rewatch = false, title = item?.title ?? 'Unmatched', year: number | null = item?.year ?? null): WatchViewing<WatchItem> => ({
  id: ++id,
  on,
  title,
  year,
  rating,
  rewatch,
  tmdbId: item?.tmdbId ?? null,
  item,
  place: title === 'Heat' && rewatch ? { name: 'Cinemateket', owner: 'Norsk filminstitutt', country: 'NO', city: 'Oslo', website: 'https://www.cinemateket.no/' } : title === 'Obscure' ? { name: 'Ukjent kino', owner: null, country: null, city: null, website: null } : null,
  episode: null,
})

const viewings = [
  viewing('2025-12-31', hunger, 3),
  viewing('2026-01-01', heat, 4.5),
  viewing('2026-01-02', collateral, 4),
  viewing('2026-03-15', heat, null, true),
  viewing('2026-03-16', null, 2, false, 'Obscure', 1999),
]

test('one item is its register number, else its title and year, however the title is written', () => {
  assert.equal(itemKey({ tmdbId: 949, title: 'x', year: 1 }), 't949')
  assert.equal(itemKey({ tmdbId: null, title: 'Så Vidt!', year: 2001 }), itemKey({ tmdbId: null, title: 'sa vidt', year: 2001 }))
  assert.notEqual(itemKey({ tmdbId: null, title: 'Heat', year: 1995 }), itemKey({ tmdbId: null, title: 'Heat', year: 1986 }))
})

test('totals count viewings and different items, the minutes where the runtime is known and the average of the ratings given', () => {
  assert.deepEqual(core.totalsOf(viewings), { plays: 5, works: 4, minutes: 100 + 170 + 100 + 170, rated: 4, averageRating: 3.38, firstOn: '2025-12-31', lastOn: '2026-03-16' })
  assert.equal(core.totalsOf([]).averageRating, null)
})

test('the best rated are each item once, with its latest rating, and one never rated is not ranked', () => {
  assert.deepEqual(core.topRated(viewings, 10).map((item) => [item.title, item.rating]), [['Heat', 4.5], ['Collateral', 4], ['Sult', 3], ['Obscure', 2]])
})

test('the lead people, actors, genres and decades are ranked by how many different items have them', () => {
  assert.deepEqual(core.topLead(viewings, 5).map((group) => [group.name, group.works]), [['Michael Mann', 2]])
  assert.deepEqual(core.topActors(viewings, 5).map((group) => [group.name, group.works]), [['Robert De Niro', 2], ['Al Pacino', 1]])
  assert.deepEqual(core.topGenres(viewings, 5).map((group) => [group.name, group.works]), [['Drama', 1], ['Krim', 1], ['Thriller', 1]])
  assert.deepEqual(core.topDecades(viewings, 5).map((group) => [group.name, group.works]), [['1990-tallet', 2], ['2000-tallet', 2]])
  assert.ok(core.topLead(viewings, 5)[0]?.slug !== null)
})

test('years are filled between the first and the last, months and weekdays have their fixed places', () => {
  assert.deepEqual(core.perYear(viewings), [{ year: 2025, plays: 1 }, { year: 2026, plays: 4 }])
  assert.deepEqual(core.perMonth(viewings).slice(0, 3), [2, 0, 2])
  assert.equal(core.perWeekday(viewings).reduce((sum, count) => sum + count, 0), 5)
  assert.equal(core.perWeekday([viewing('2026-03-16', null)])[0], 1)
})

test('every item seen and everyone credited on one and every place has a page', () => {
  const entities = core.entitiesOf(viewings)
  assert.deepEqual(entities.map((entity) => [entity.kind, entity.name]), [
    ['film', 'Collateral'], ['film', 'Heat'], ['film', 'Obscure'], ['film', 'Sult'],
    ['person', 'Al Pacino'], ['person', 'Elliot Goldenthal'], ['person', 'Michael Mann'], ['person', 'Robert De Niro'],
    ['cinema', 'Cinemateket'], ['cinema', 'Ukjent kino'],
  ])
  assert.equal(new Set(entities.map((entity) => entity.slug)).size, entities.length)
})

test('a poster is only served where the file name is plain', () => {
  assert.equal(posterUrl({ posterPath: '/../x.jpg' }), null)
  assert.equal(posterUrl(null), null)
})

test('the page of a person has the items seen that they led and acted in, newest first', () => {
  const mannPage = core.personPageOf(viewings, 1100, undefined)
  assert.deepEqual([mannPage?.lead.map((item) => item.title), mannPage?.acted.length], [['Collateral', 'Heat'], 0])
  assert.deepEqual(core.personPageOf(viewings, 380, undefined)?.acted.map((item) => item.title), ['Collateral', 'Heat'])
  assert.equal(core.personPageOf(viewings, 99, undefined), null)
})

test('a person who only worked behind the camera has a page with the items and the register\'s facts, and a long biography is cut at a sentence', () => {
  const composer = core.personPageOf(viewings, 7, { birthday: '1952-05-02', deathday: null, placeOfBirth: 'Brooklyn', biography: 'First. Second.', biographyLanguage: 'en', department: 'Sound', imdbId: 'nm1' })
  assert.deepEqual([composer?.name, composer?.crewed.map((group) => [group.job, group.works.map((item) => item.title)]), composer?.born, composer?.biography], ['Elliot Goldenthal', [['Composer', ['Heat']]], '1952-05-02', 'First. Second.'])
  assert.equal(excerpt('One sentence. '.repeat(100), 100), 'One sentence. '.repeat(7).trim())
  assert.equal(excerpt('x'.repeat(200), 100), `${'x'.repeat(100)}…`)
})

test('the places are ranked by the items seen in them, and one nobody described counts only under its name', () => {
  assert.deepEqual(core.topPlaces(viewings, 5).map((group) => [group.name, group.works]), [['Cinemateket', 1], ['Ukjent kino', 1]])
  assert.deepEqual(core.topPlaces(viewings.filter((line) => line.on?.startsWith('2025')), 5), [])
})

test('the page of a place has its facts, the visits and the items seen there newest first, and a slug no viewing has is none', () => {
  const page = core.placePageOf(viewings, core.placeSlug('Cinemateket'))
  assert.deepEqual([page?.name, page?.owner, page?.city, page?.country, page?.visits, page?.first, page?.last, page?.works.map((item) => [item.title, item.plays]), page?.website], ['Cinemateket', 'Norsk filminstitutt', 'Oslo', 'Norge', 1, '2026-03-15', '2026-03-15', [['Heat', 1]], 'https://www.cinemateket.no/'])
  assert.equal(core.placePageOf(viewings, core.placeSlug('Ukjent kino'))?.country, null)
  assert.equal(core.placePageOf(viewings, 'nope'), null)
  assert.ok(core.entitiesOf(viewings).some((entity) => entity.kind === 'cinema' && entity.slug === core.placeSlug('Cinemateket')))
})

test('the seen list is newest first and a viewing with no known day counts first in the list of the item page', () => {
  const place: WatchPlace = { name: 'Elsewhere', owner: null, country: null, city: null, website: null }
  const undated: WatchViewing<WatchItem> = { ...viewing(null, collateral, 5), place }
  const all = [...viewings, undated]
  assert.deepEqual([core.totalsOf(all).plays, core.totalsOf(all).firstOn, core.totalsOf(all).lastOn], [core.totalsOf(viewings).plays + 1, '2025-12-31', '2026-03-16'])
  assert.deepEqual(core.perYear(all), core.perYear(viewings))
  assert.deepEqual(core.seenOf(all.filter((item) => itemKey(item) === 't1')).map((seen) => seen.on), ['2026-01-02', null])
  assert.equal(core.placePageOf(all.filter((item) => item.place?.name === 'Elsewhere'), core.placeSlug('Elsewhere'))?.first, null)
})

test('the library is what was seen, and a collection adds what is owned or wanted: an owned film that was seen stays seen and is owned', () => {
  const alien = info(348, 'Alien', 1979, { genres: ['Skrekk'], posterPath: '/a.jpg', credits: [credit(578, 'Ridley Scott', 'Director')] })
  const line = (title: string, year: number | null, status: 'owned' | 'want', item: WatchItem | null, rating: number | null = null) => ({ title, year, status, rating, addedOn: null, tmdbId: item?.tmdbId ?? null, format: null, item })
  const { works } = core.libraryOf(viewings, [line('Heat', 1995, 'owned', heat), line('Heat', 1995, 'want', heat), line('Alien', 1979, 'owned', alien, 5), line('Unknown', null, 'want', null)])
  const by = (title: string) => works.find((work) => work.title === title)
  assert.deepEqual([by('Heat')?.status, by('Heat')?.owned, by('Heat')?.plays], ['done', true, 2])
  assert.deepEqual([by('Alien')?.status, by('Alien')?.owned, by('Alien')?.plays, by('Alien')?.slug, by('Alien')?.creator, by('Alien')?.rating], ['owned', true, 0, core.itemSlug('t348'), 'Ridley Scott', 5])
  assert.deepEqual([by('Unknown')?.status, by('Unknown')?.owned, by('Unknown')?.cover], ['want', false, null])
  assert.equal(works.length, core.libraryOf(viewings).works.length + 2)
  assert.deepEqual(core.libraryOf(viewings).works.map((work) => work.owned), [false, false, false, false])
  // What is in the collection and was never seen is its own set, one line a work, and gets a page like any work.
  assert.deepEqual(core.unseenOf(viewings, [line('Heat', 1995, 'owned', heat), line('Alien', 1979, 'want', alien), line('Alien', 1979, 'owned', alien)]).map((unseen) => [unseen.title, unseen.status]), [['Alien', 'owned']])
})

test('the page of a cinema splits its visits by the hall the seat names, the most visited first and the visits with no hall last', () => {
  const place: WatchPlace = { name: 'Ringen kino', owner: null, country: null, city: null, website: null }
  const at = (on: string, item: WatchItem, seat: string | null): WatchViewing<WatchItem> => ({ ...viewing(on, item), place, seat })
  const visits = [at('2026-01-01', heat, 'Sal 3, rad 2, sete 4'), at('2026-02-01', collateral, 'Sal 1, rad 7, sete 6, 5'), at('2026-03-01', hunger, 'Sal 1, rad 1, sete 1'), at('2026-04-01', heat, null)]
  const page = core.placePageOf(visits, core.placeSlug('Ringen kino'))
  assert.deepEqual(page?.halls.map((hall) => [hall.name, hall.visits, hall.works.map((work) => work.title)]), [['Sal 1', 2, ['Sult', 'Collateral']], ['Sal 3', 1, ['Heat']], [null, 1, ['Heat']]])
  assert.equal(page?.visits, 4)
})

test('a place whose visits name no hall has no halls', () => {
  const place: WatchPlace = { name: 'Netflix', owner: null, country: null, city: null, website: null }
  assert.deepEqual(core.placePageOf([{ ...viewing('2026-01-01', heat), place }], core.placeSlug('Netflix'))?.halls, [])
})
