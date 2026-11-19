import assert from 'node:assert/strict'
import { test } from 'node:test'

import { hoursAndMinutes } from './words.ts'

test('a line of the log says hours and minutes', () => {
  assert.equal(hoursAndMinutes(0.5), '30 min')
  assert.equal(hoursAndMinutes(2), '2 t')
  assert.equal(hoursAndMinutes(3.16).replace(/\s/g, ' '), '3 t 10 min')
  assert.equal(hoursAndMinutes(0.001), '1 min')
})
