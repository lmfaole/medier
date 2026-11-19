import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import type { FilmInfo } from '../words.ts'
import { filmPageOf, type Viewing } from './film-stats.ts'

/**
 * The counting itself is `packages/watch/src/viewing.test.ts`; what is film's own is the page of one film: the
 * register's facts about it (the tagline, the money, the age rating) and every viewing of it.
 */

const credit = (id: number, name: string, job: string, character: string | null = null) => ({ id, name, job, character })

const info = (tmdbId: number, title: string, year: number, more: Partial<FilmInfo> = {}): FilmInfo => ({
  tmdbId, title, originalTitle: title, year, runtimeMinutes: 100, overview: null, tagline: null, posterPath: null, backdropPath: null, languages: [], language: 'en', genres: ['Krim'], countries: ['USA'], credits: [],
  voteAverage: null, voteCount: null, budget: null, revenue: null, imdbId: null, wikidataId: null, certification: null, releasedNo: null, collection: null, companies: [], keywords: [], ...more,
})

const heat = info(949, 'Heat', 1995, {
  runtimeMinutes: 170,
  posterPath: '/p.jpg',
  certification: 'NR',
  keywords: ['heist'],
  credits: [credit(1100, 'Michael Mann', 'Director'), credit(1158, 'Al Pacino', 'Cast', 'Hanna'), credit(380, 'Robert De Niro', 'Cast', 'McCauley'), credit(1100, 'Michael Mann', 'Writer'), credit(7, 'Elliot Goldenthal', 'Composer')],
})
const collateral = info(1, 'Collateral', 2004, { credits: [credit(1100, 'Michael Mann', 'Director'), credit(380, 'Robert De Niro', 'Cast')] })
const hunger = info(4, 'Sult', 2008, { originalTitle: 'Hunger', genres: ['Drama'], countries: ['Storbritannia'] })

let id = 0
const viewing = (on: string | null, film: FilmInfo | null, rating: number | null = null, rewatch = false, title = film?.title ?? 'Unmatched', year: number | null = film?.year ?? null): Viewing => ({
  id: ++id,
  on,
  title,
  year,
  rating,
  rewatch,
  tmdbId: film?.tmdbId ?? null,
  item: film,
  place: title === 'Heat' && rewatch ? { name: 'Cinemateket', owner: 'Norsk filminstitutt', country: 'NO', city: 'Oslo', website: 'https://www.cinemateket.no/' } : null,
  episode: null,
})

const viewings: Viewing[] = [viewing('2025-12-31', hunger, 3), viewing('2026-01-01', heat, 4.5), viewing('2026-01-02', collateral, 4), viewing('2026-03-15', heat, null, true)]

test('the page of a film has its people and every viewing, newest first, and an age rating of «not rated» is none', () => {
  const page = filmPageOf(viewings, 't949')
  assert.deepEqual([page?.title, page?.year, page?.lead.map((person) => person.name), page?.seen.map((seen) => seen.on), page?.cover], ['Heat', 1995, ['Michael Mann'], ['2026-03-15', '2026-01-01'], '/posters/p.jpg'])
  assert.equal(filmPageOf(viewings, 'nope'), null)
  assert.equal(page?.facts.find(([label]) => label === 'Aldersgrense')?.[1], null)
  assert.deepEqual(page?.keywords, ['heist'])
  assert.deepEqual(page?.crew.map((group) => [group.job, group.people.map((person) => person.name)]), [['Writer', ['Michael Mann']], ['Composer', ['Elliot Goldenthal']]])
  assert.deepEqual(page?.seen.map((seen) => seen.place?.name ?? null), ['Cinemateket', null])
  assert.equal(filmPageOf(viewings, 't4')?.originalTitle, 'Hunger')
  assert.deepEqual(page?.cast.map((person) => person.character), ['Hanna', 'McCauley'])
})

test('the register\'s facts and links of a film travel with its page, and where the register has nothing the fact says nothing', () => {
  const page = filmPageOf(viewings, 't949')
  assert.deepEqual(page?.facts.slice(0, 4), [['Spilletid', '2 t 50 min'], ['Sjanger', 'Krim'], ['Land', 'USA'], ['Språk', 'engelsk']])
  assert.deepEqual(page?.facts.slice(4), [['Talt', null], ['Aldersgrense', null], ['Utgitt i Norge', null], ['TMDB-snitt', null], ['Budsjett', null], ['Inntekter', null], ['Samling', null], ['Selskaper', '']])
  assert.deepEqual(page?.links, [['IMDb', null], ['TMDB', 'https://www.themoviedb.org/movie/949'], ['Wikidata', null]])
  // Where more than one language is spoken, the page lists them.
  const spoken = filmPageOf([viewing('2026-01-01', info(949, 'Heat', 1995, { languages: ['Engelsk', 'Spansk'] }), 4.5)], 't949')
  assert.deepEqual(spoken?.facts.find(([label]) => label === 'Talt'), ['Talt', 'Engelsk, Spansk'])
})
