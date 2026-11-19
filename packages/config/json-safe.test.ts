import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { jsonProblems } from './json-safe.ts'

test('what JSON keeps as it is gives no problem, an absent field included', () => {
  assert.deepEqual(jsonProblems({ a: 1, b: 'x', c: null, d: [1, { e: true }], f: undefined, g: Object.create(null) }), [])
})

test('NaN, Infinity, a Date, a Map, a bigint and a hole in a list are each named with their path', () => {
  const problems = jsonProblems({ rate: Number.NaN, nested: { max: Infinity }, when: new Date(0), set: new Set([1]), list: [1, undefined], big: 1n })
  assert.deepEqual(problems, [
    '$.rate: NaN becomes null',
    '$.nested.max: Infinity becomes null',
    '$.when: Date becomes something else (a Date becomes text, a Map or Set becomes {})',
    '$.set: Set becomes something else (a Date becomes text, a Map or Set becomes {})',
    '$.list: [1] is undefined and becomes null',
  ])
})

test('a value that refers to itself is one problem, and the same object twice is not', () => {
  const loop: Record<string, unknown> = {}
  loop['self'] = loop
  assert.deepEqual(jsonProblems(loop), ['$.self: refers to itself'])
  const shared = { n: 1 }
  assert.deepEqual(jsonProblems({ a: shared, b: shared }), [])
})
