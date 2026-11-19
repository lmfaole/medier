import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { calendarDays, logSeries } from './log-series.ts'

test('a log is a series of days when it is short and of months when it is long, with the empty ones between, and an undated line is counted apart', () => {
  const line = (on: string | null, amount: number | null) => ({ on, status: 'playing', rating: null, amount, format: null })
  const short = logSeries([line('2021-12-05', 2), line('2021-12-07', 1.5), line('2021-12-07', 1), line(null, 4)])
  assert.deepEqual([short.unit, short.labels, short.lines, short.amounts, short.undated], ['day', ['2021-12-05', '2021-12-06', '2021-12-07'], [1, 0, 2], [2, 0, 2.5], 1])
  const long = logSeries([line('2021-11-20', 3), line('2022-02-01', 5)])
  assert.deepEqual([long.unit, long.labels, long.lines, long.first, long.last], ['month', ['2021-11', '2021-12', '2022-01', '2022-02'], [1, 0, 0, 1], '2021-11-20', '2022-02-01'])
  assert.deepEqual(logSeries([line(null, 1)]).labels, [])
})

test('the calendar has a row for every day up to a year back, empty days as 0', () => {
  const days = calendarDays([{ on: '2026-01-01' }, { on: '2026-01-03' }, { on: '2026-01-03' }, { on: null }])
  assert.deepEqual(days, [{ date: '2026-01-01', value: 1 }, { date: '2026-01-02', value: 0 }, { date: '2026-01-03', value: 2 }])
  assert.deepEqual(calendarDays([{ on: null }]), [])
  const long = calendarDays([{ on: '2020-01-01' }, { on: '2026-06-30' }])
  assert.equal(long.length, 365)
  assert.equal(long.at(-1)?.date, '2026-06-30')
})
