import assert from 'node:assert/strict'
import { test } from 'node:test'

import { genreName, productionCountryName } from './names.ts'

test('a genre and a country of the register are put into Norwegian, and what is not known stays as it came', () => {
  assert.equal(genreName('Science Fiction'), 'Science fiction')
  assert.equal(genreName('Krim'), 'Krim')
  assert.equal(productionCountryName('United States of America'), 'USA')
  assert.equal(productionCountryName('Norway'), 'Norge')
  assert.equal(productionCountryName('Atlantis'), 'Atlantis')
})
