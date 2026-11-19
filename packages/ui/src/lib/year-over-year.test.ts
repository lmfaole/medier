import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { yearOverYear } from './year-over-year.ts'

const month = (start: string, plays: number, ongoing = false) => ({ start, plays, ongoing })
const label = (start: string) => start.slice(5, 7)

test('a month is set against the same month a year earlier, whole months only, and a year needs three pairs', () => {
  const months = [month('2026-03-01', 90), month('2026-02-01', 70), month('2026-01-01', 50), month('2026-04-01', 10, true), month('2025-04-01', 80), month('2025-03-01', 60), month('2025-02-01', 40), month('2025-01-01', 30)]
  assert.deepEqual(yearOverYear(months, label), { rows: [{ label: '01', from: 30, to: 50 }, { label: '02', from: 40, to: 70 }, { label: '03', from: 60, to: 90 }], fromYear: '2025', toYear: '2026' })
  assert.equal(yearOverYear(months.slice(0, 4), label), null)
  assert.equal(yearOverYear([], label), null)
})
