import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { platformOf } from './platforms.ts'

test('every generation of a brand is its logo, a system with no logo is the generic one, named, and a format that is no platform is none', () => {
  assert.deepEqual([platformOf('PlayStation'), platformOf('xbox one'), platformOf(' PS2 ')], [{ kind: 'brand', brand: 'playstation' }, { kind: 'brand', brand: 'xbox' }, { kind: 'brand', brand: 'playstation' }])
  assert.deepEqual(platformOf('gba'), { kind: 'other', name: 'Game Boy Advance' })
  assert.deepEqual([platformOf('digital'), platformOf('cd')], [null, null])
})
