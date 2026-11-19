import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { watchApi } from './api.ts'
import { watchSnapshot } from './snapshot.ts'
import type { WatchConfig, WatchItem, WatchViewing } from './viewing.ts'

const CONFIG: WatchConfig<'film', 'cinema'> = { noun: { one: 'film', many: 'filmer' }, itemKind: 'film', placeKind: 'cinema', leadJob: 'Director', crewJobs: [] }
const item = (tmdbId: number, title: string, year: number): WatchItem => ({ tmdbId, title, year, runtimeMinutes: 100, posterPath: null, backdropPath: null, languages: [], genres: [], countries: [], credits: [] })
let id = 0
const viewing = (on: string | null, title: string, year: number): WatchViewing<WatchItem> => ({ id: ++id, on, title, year, rating: null, rewatch: false, tmdbId: id, item: item(id, title, year), place: null, episode: null })

const VIEWINGS = [viewing('2024-12-31', 'Old', 2000), viewing('2025-03-01', 'Mid', 2001), viewing('2026-01-01', 'New Year', 2002), viewing('2026-05-02', 'Later', 2003), viewing(null, 'Undated', 2004)]
const db: D1Database = Object.create(null)
const api = watchApi(CONFIG, { viewingsOf: async () => VIEWINGS, personInfoOf: async () => new Map(), itemPageOf: () => null })
const ask = (query: string) => api.history(db, new URL(`http://x/api/history.json${query}`))

test('the history is one year, the newest without one, with the years to choose from newest first', async () => {
  const newest = await ask('')
  assert.deepEqual([newest.year, newest.years], ['2026', ['2026', '2025', '2024']])
  assert.deepEqual(newest.plays.map((play) => play.title), ['Later', 'New Year'])
  assert.deepEqual((await ask('?year=2025')).plays.map((play) => play.title), ['Mid'])
  assert.deepEqual((await ask('?year=2024')).plays.map((play) => play.on), ['2024-12-31'])
})

test('a year the log does not have, or a month, falls back on the newest year, and a viewing with no day is in no year', async () => {
  assert.equal((await ask('?year=1999')).year, '2026')
  assert.equal((await ask('?month=2025-03')).year, '2026')
  const everyone = (await Promise.all(['2024', '2025', '2026'].map((year) => ask(`?year=${year}`)))).flatMap((history) => history.plays.map((play) => play.title))
  assert.ok(!everyone.includes('Undated'))
})

test('the answer has a year and years, not a month and months', async () => {
  const answer = await ask('')
  assert.ok(!('month' in answer) && !('months' in answer))
})

test('the snapshot has a file for the history of each year with a viewing, and none for a month', async () => {
  const requests = await watchSnapshot({ config: CONFIG, viewingsOf: async () => VIEWINGS }).requests(db)
  for (const year of ['2024', '2025', '2026']) assert.ok(requests.includes(`/api/history.json?year=${year}`), year)
  assert.ok(requests.includes('/api/history.json'))
  assert.ok(!requests.some((request) => request.startsWith('/api/history.json?month=')))
})
