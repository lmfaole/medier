import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { copiesOf, formatLabel, ownershipOf, ownershipRating, ownershipValue } from './ownership.ts'

const line = (status: 'owned' | 'want', format: string | null, addedOn: string | null = null, rating: number | null = null) => ({ status, format, addedOn, rating })

test('ownership is owned when any line says so, with the formats of the owned lines once each, and a want otherwise; every line is kept', () => {
  assert.equal(ownershipOf([]), null)
  const lines = [line('want', 'blu-ray'), line('owned', 'dvd, blu-ray', '2026-01-02', 4), line('owned', 'blu-ray')]
  assert.deepEqual(ownershipOf(lines), { status: 'owned', format: 'dvd, blu-ray', lines })
  assert.deepEqual(ownershipOf([line('want', null)]), { status: 'want', format: null, lines: [line('want', null)] })
  assert.equal(ownershipRating(ownershipOf(lines)), 4)
  assert.equal(ownershipRating(null), null)
})

test('only the fields a page tells are kept of a line, so a register item a line carries is not published', () => {
  const withItem = { ...line('owned', 'cd'), item: { credits: ['x'] } }
  const [kept] = ownershipOf([withItem])?.lines ?? []
  assert.deepEqual(Object.keys(kept ?? {}).toSorted(), ['addedOn', 'format', 'rating', 'status'])
})

test('a format is told in words, several at once, and an unknown one with a capital', () => {
  assert.equal(formatLabel('cd, vinyl'), 'CD, Vinyl')
  assert.equal(formatLabel('switch'), 'Switch')
  assert.equal(formatLabel(' , '), null)
  assert.equal(ownershipValue({ status: 'owned', format: 'cd', lines: [line('owned', 'cd')] }), 'CD')
  assert.equal(ownershipValue({ status: 'owned', format: null, lines: [line('owned', null)] }), 'Ja')
  assert.equal(ownershipValue({ status: 'want', format: 'cd', lines: [] }), 'Nei, ønsker meg')
})

test('a second copy is a second owned line and the tile counts them', () => {
  const twice = ownershipOf([line('owned', 'vinyl'), line('owned', 'vinyl'), line('want', 'cd')])
  assert.equal(twice === null ? 0 : copiesOf(twice), 2)
  assert.equal(twice === null ? '' : ownershipValue(twice), 'Vinyl ×2')
  const across = ownershipOf([line('owned', 'xbox'), line('owned', 'playstation'), line('owned', 'xbox'), line('owned', null)])
  assert.equal(across === null ? '' : ownershipValue(across), 'Xbox ×2, PlayStation')
  const unnamed = ownershipOf([line('owned', null), line('owned', null)])
  assert.equal(unnamed === null ? '' : ownershipValue(unnamed), 'Ja, 2 eksemplarer')
})
