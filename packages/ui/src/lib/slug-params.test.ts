import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import * as v from 'valibot'

import { SlugParams } from './slug-params.ts'

test('a slug is kept', () => {
  assert.deepEqual(v.parse(SlugParams, { slug: 'el-mal-querer-rosal-a-ed2da769' }), { slug: 'el-mal-querer-rosal-a-ed2da769' })
})

test('text that is no slug is refused', () => {
  for (const slug of ['', 'UPPER', 'a/b', 'a b']) assert.equal(v.safeParse(SlugParams, { slug }).success, false, slug)
})
