import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { artistOf } from './concert-artist.ts'

const artists = new Map([['zara larsson', 'Zara Larsson'], ['carina dahl', 'Carina Dahl'], ['pumpegris', 'Pumpegris']])

test('a concert is the artist\'s when the title is the name or is a side of a separator, and not when the name is only inside it', () => {
  assert.equal(artistOf('Carina Dahl', artists), 'Carina Dahl')
  assert.equal(artistOf('Zara Larsson - Midnight Sun 2025 Tour', artists), 'Zara Larsson')
  assert.equal(artistOf('Oslo World: Pumpegris', artists), 'Pumpegris')
  assert.equal(artistOf('Oslo World: Someone Else', artists), null)
  assert.equal(artistOf('Skeiv Natt med Carina Dahl', artists), null)
})
