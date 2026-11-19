import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import type { TvInfo } from '../words.ts'
import { seriesPageOf, type Viewing } from './tv-stats.ts'

/**
 * The counting itself is `packages/watch/src/viewing.test.ts`; what is TV's own is the page of one series: the
 * register's facts about it (its seasons, its air dates, its status) and every episode watched of it.
 */

const credit = (id: number, name: string, job: string, character: string | null = null) => ({ id, name, job, character })

const info = (tmdbId: number, title: string, year: number, more: Partial<TvInfo> = {}): TvInfo => ({
  tmdbId, title, originalTitle: title, year, runtimeMinutes: 50, overview: null, tagline: null, posterPath: null, backdropPath: null, languages: [], language: 'en', genres: ['Drama'], countries: ['USA'], credits: [],
  voteAverage: null, voteCount: null, imdbId: null, wikidataId: null, firstAirDate: `${year}-01-01`, lastAirDate: null, seasons: 1, episodes: 10, status: 'Returning Series', inProduction: true,
  homepage: null, companies: [], keywords: [], next: null, ...more,
})

const severance = info(95396, 'Separasjonen', 2022, {
  runtimeMinutes: 55,
  posterPath: '/s.jpg',
  seasons: 2,
  episodes: 19,
  keywords: ['dystopia'],
  firstAirDate: '2022-02-18',
  lastAirDate: '2025-03-21',
  inProduction: false,
  status: 'Ended',
  credits: [credit(1, 'Dan Erickson', 'Creator'), credit(2, 'Ben Stiller', 'Creator'), credit(3, 'Adam Scott', 'Cast', 'Mark'), credit(4, 'Britt Lower', 'Cast', 'Helly'), credit(1, 'Dan Erickson', 'Writer'), credit(5, 'Theodore Shapiro', 'Composer')],
})
const office = info(2316, 'Kontoret', 2005, { credits: [credit(6, 'Greg Daniels', 'Creator'), credit(3, 'Adam Scott', 'Cast', 'Andy')] })
const riget = info(4, 'Riget', 1994, { originalTitle: 'Riget', genres: ['Mysterium'], countries: ['Danmark'] })

let id = 0
const viewing = (on: string | null, series: TvInfo | null, season: number | null = 1, episode: number | null = 1, rating: number | null = null, rewatch = false, title = series?.title ?? 'Unmatched'): Viewing => ({
  id: ++id,
  on,
  title,
  year: series?.year ?? null,
  rating,
  rewatch,
  tmdbId: series?.tmdbId ?? null,
  item: series,
  place: series === severance ? { name: 'Apple TV+', owner: null, country: 'US', city: null, website: null } : null,
  episode: season === null && episode === null ? null : { season, episode },
})

const viewings: Viewing[] = [
  viewing('2025-12-31', riget, 1, 1, 3),
  viewing('2026-01-01', severance, 1, 1, 4.5),
  viewing('2026-01-02', office, null, null, 4),
  viewing('2026-03-15', severance, 2, 5, null, true),
]

test("the page of a series has its creators and every viewing, newest first, and the log's own episode", () => {
  const page = seriesPageOf(viewings, 't95396')
  assert.deepEqual([page?.title, page?.year, page?.lead.map((person) => person.name), page?.seen.map((seen) => seen.on), page?.cover], ['Separasjonen', 2022, ['Dan Erickson', 'Ben Stiller'], ['2026-03-15', '2026-01-01'], '/posters/s.jpg'])
  assert.equal(seriesPageOf(viewings, 'nope'), null)
  assert.deepEqual(page?.seen.map((seen) => seen.episode), [{ season: 2, episode: 5 }, { season: 1, episode: 1 }])
  assert.deepEqual(page?.keywords, ['dystopia'])
  assert.deepEqual(page?.crew.map((group) => [group.job, group.people.map((person) => person.name)]), [['Writer', ['Dan Erickson']], ['Composer', ['Theodore Shapiro']]])
  assert.deepEqual(page?.seen.map((seen) => seen.place?.name ?? null), ['Apple TV+', 'Apple TV+'])
  assert.deepEqual(page?.cast.map((person) => person.character), ['Mark', 'Helly'])
})

test("the register's facts and links of a series travel with its page, and a viewing of no episode is the series itself", () => {
  const page = seriesPageOf(viewings, 't95396')
  assert.deepEqual(page?.facts, [
    ['Episodelengde', '55 min'],
    ['Sesonger', '2'],
    ['Episoder', '19'],
    ['Sjanger', 'Drama'],
    ['Land', 'USA'],
    ['Språk', 'engelsk'],
    ['Talt', null],
    ['Sendt', '18. februar 2022 – 21. mars 2025'],
    ['Neste episode', null],
    ['Sendes', null],
    ['Status', 'Avsluttet'],
    ['TMDB-snitt', null],
    ['Selskaper', ''],
  ])
  assert.deepEqual(page?.links, [['IMDb', null], ['TMDB', 'https://www.themoviedb.org/tv/95396'], ['Wikidata', null], ['Nettside', null]])
  assert.deepEqual(seriesPageOf(viewings, 't2316')?.seen.map((seen) => seen.episode), [null])
})

test('a series still running has no last air date to show', () => {
  assert.deepEqual(seriesPageOf([viewing('2026-01-01', office)], 't2316')?.facts.find(([label]) => label === 'Sendt'), ['Sendt', '1. januar 2005 –'])
  assert.equal(seriesPageOf([viewing('2026-01-01', severance)], 't95396')?.facts.find(([label]) => label === 'Status')?.[1], 'Avsluttet')
})

test('a series with an announced episode shows when it comes, and one with none shows nothing', () => {
  const next = { season: 5, episode: 5, name: 'Fire', airDate: '2026-10-23' }
  const facts = seriesPageOf([viewing('2026-01-01', { ...severance, next })], 't95396')?.facts
  assert.equal(facts?.find(([label]) => label === 'Neste episode')?.[1], 'Sesong 5, episode 5: Fire')
  assert.match(String(facts?.find(([label]) => label === 'Sendes')?.[1]), /2026/)
  assert.equal(seriesPageOf([viewing('2026-01-01', severance)], 't95396')?.facts.find(([label]) => label === 'Neste episode')?.[1] ?? null, null)
})
