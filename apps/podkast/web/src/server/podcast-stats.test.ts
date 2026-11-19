import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { type Play, entitiesOf, episodePageOf, showPageOf, monthsOf, perHour, perMonth, perWeekday, perYear, recentOf, topEpisodes, topShows, totalsOf } from './podcast-stats.ts'

const at = (iso: string) => Date.parse(iso) / 1000
const play = (iso: string, show: string, episode: string, minutes = 10): Play => ({ at: at(iso), show, episode, ms: minutes * 60_000 })

const plays = [
  play('2020-03-01T12:00:00Z', 'Vergecast', 'One'),
  play('2020-03-02T12:00:00Z', 'Vergecast', 'One'),
  play('2020-03-03T12:00:00Z', 'Debatten', 'Two', 40),
  play('2023-06-01T12:00:00Z', 'Debatten', 'Three', 40),
]

test('shows and episodes rank by plays, then minutes, and an episode is told apart by its show', () => {
  assert.deepEqual(topShows(plays, 5).map(({ name, plays: count, episodes }) => [name, count, episodes]), [
    ['Debatten', 2, 2],
    ['Vergecast', 2, 1],
  ])
  assert.deepEqual(topEpisodes([...plays, play('2020-04-01T12:00:00Z', 'Other', 'One')], 5).map(({ name, show, plays: count }) => [name, show, count]), [
    ['One', 'Vergecast', 2],
    ['Three', 'Debatten', 1],
    ['Two', 'Debatten', 1],
    ['One', 'Other', 1],
  ])
})

test('totals count the plays, the minutes, the shows and the episodes', () => {
  assert.deepEqual(totalsOf(plays), { plays: 4, minutes: 100, shows: 2, episodes: 3, firstAt: plays[0]?.at ?? null, lastAt: plays[3]?.at ?? null })
  assert.deepEqual(totalsOf([]), { plays: 0, minutes: 0, shows: 0, episodes: 0, firstAt: null, lastAt: null })
})

test('a year with no plays between two with some is a column of zero', () => {
  assert.deepEqual(perYear(plays).map((entry) => entry.plays), [3, 0, 0, 1])
  assert.deepEqual(perYear([]), [])
})

test('an hour is the hour in Oslo', () => {
  const hours = perHour([play('2023-06-01T22:30:00Z', 'Show', 'Late')])
  assert.equal(hours[0], 1)
  assert.equal(hours.reduce((sum, count) => sum + count, 0), 1)
})

test('the recent plays are the newest first', () => {
  assert.deepEqual(recentOf(plays, 2).map((entry) => entry.episode), ['Three', 'Two'])
})

test('the months with a play are newest first', () => {
  assert.deepEqual(monthsOf(plays), ['2023-06', '2020-03'])
})

test('every show and every episode has a page, an episode told apart by its show', () => {
  const entities = entitiesOf([...plays, play('2020-04-01T12:00:00Z', 'Other', 'One')])
  assert.deepEqual(entities.map((entity) => [entity.kind, entity.name, entity.show]), [
    ['show', 'Debatten', null],
    ['show', 'Other', null],
    ['show', 'Vergecast', null],
    ['episode', 'Three', 'Debatten'],
    ['episode', 'Two', 'Debatten'],
    ['episode', 'One', 'Other'],
    ['episode', 'One', 'Vergecast'],
  ])
  assert.equal(new Set(entities.map((entity) => entity.slug)).size, entities.length)
})

test('the page of a show has its totals, its years and its top episodes; of an episode, its show and when it was played', () => {
  const show = showPageOf(plays, 'Vergecast')
  assert.deepEqual([show?.totals.plays, show?.years.length, show?.topEpisodes.map((episode) => episode.name)], [2, 1, ['One']])
  const episode = episodePageOf(plays, 'Vergecast', 'One')
  assert.deepEqual([episode?.show.name, episode?.totals.plays, episode?.listens.length], ['Vergecast', 2, 2])
  assert.ok((episode?.listens[0] ?? 0) > (episode?.listens[1] ?? 0))
  assert.equal(showPageOf(plays, 'Nobody'), null)
  assert.equal(episodePageOf(plays, 'Vergecast', 'Two'), null)
})


test('months and weekdays are counted on Oslo days, oldest month first, Monday first', () => {
  const played = [play('2023-06-04T22:30:00Z', 'Show', 'A'), play('2023-05-31T10:00:00Z', 'Show', 'B')]
  assert.deepEqual(perMonth(played), [{ month: '2023-05', plays: 1 }, { month: '2023-06', plays: 1 }])
  // 22:30Z on a Sunday is already Monday in Oslo; 2023-05-31 was a Wednesday.
  assert.deepEqual(perWeekday(played), [1, 0, 1, 0, 0, 0, 0])
})
