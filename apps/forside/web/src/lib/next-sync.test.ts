import assert from 'node:assert/strict'
import { test } from 'node:test'

import { daily, describeNext, everyThreeHours, nextRun, weekly } from './next-sync.ts'

const iso = (date: Date) => date.toISOString()

test('every three hours picks the next slot of the day, and rolls over midnight', () => {
  assert.equal(iso(nextRun(everyThreeHours(17), new Date('2026-10-28T10:00:00Z'))), '2026-10-28T11:17:00.000Z')
  assert.equal(iso(nextRun(everyThreeHours(17), new Date('2026-10-28T22:30:00Z'))), '2026-10-28T23:17:00.000Z')
})

test('a daily run that has passed today is tomorrow, in Norwegian time (winter, UTC+1)', () => {
  assert.equal(iso(nextRun(daily(4, 15), new Date('2026-11-10T03:30:00Z'))), '2026-11-11T03:15:00.000Z')
  assert.equal(iso(nextRun(daily(4, 15), new Date('2026-11-10T02:00:00Z'))), '2026-11-10T03:15:00.000Z')
})

test('summer time moves the instant: 04:15 in Oslo is 02:15 UTC', () => {
  assert.equal(iso(nextRun(daily(4, 15), new Date('2026-07-01T00:00:00Z'))), '2026-07-01T02:15:00.000Z')
})

test('a weekly run waits for its weekday', () => {
  assert.equal(iso(nextRun(weekly(0, 4, 25), new Date('2026-10-28T10:00:00Z'))), '2026-11-01T03:25:00.000Z')
})

test('the next run is described by day and time', () => {
  const now = new Date('2026-10-28T10:00:00Z')
  assert.equal(describeNext(nextRun(daily(4, 15), now), now), 'i morgen 04:15')
  assert.equal(describeNext(nextRun(weekly(0, 4, 25), now), now), 'søndag 04:25')
})
