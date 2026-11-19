import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { capitalize, excerpt, normalizeTitle, slugOf, titleWithYear } from './text.ts'

test('a slug is the letters of the text and a hash of all of it, the same every time', () => {
  assert.equal(slugOf('Dagsnytt 18'), slugOf('Dagsnytt 18'))
  assert.match(slugOf('Dagsnytt 18'), /^dagsnytt-18-[0-9a-f]{8}$/)
  assert.match(slugOf('Så vidt – «Øl»!'), /^sa-vidt-ol-[0-9a-f]{8}$/)
  assert.notEqual(slugOf('A B'), slugOf('A-B'))
  assert.match(slugOf('!!!'), /^x-[0-9a-f]{8}$/)
})

test('titles are the same where their letters and digits are, and a long text is cut at a word', () => {
  assert.equal(normalizeTitle('Så vidt: «Øl», 2!'), normalizeTitle('sa vidt ol 2'))
  assert.notEqual(normalizeTitle('Episode 1'), normalizeTitle('Episode 11'))
  assert.equal(excerpt('short', 20), 'short')
  assert.equal(excerpt('one two three four', 10), 'one two…')
  assert.equal(excerpt('abcdefghijklmnop', 10), 'abcdefghij…')
})

test('a text gets a capital first, an empty one stays empty and an Å stays an Å', () => {
  assert.deepEqual(['august', '', 'åpent', 'Mars'].map(capitalize), ['August', '', 'Åpent', 'Mars'])
})

test('a title has its year in brackets where there is one', () => {
  assert.equal(titleWithYear('Alien', 1979), 'Alien (1979)')
  assert.equal(titleWithYear('Alien', null), 'Alien')
  assert.equal(titleWithYear('Alien', ''), 'Alien')
})
