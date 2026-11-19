import assert from 'node:assert/strict'
import { test } from 'node:test'

import { bookFacts, facetFacts, facetName, toBeatLine } from './facets.ts'
import { noFacets } from './shelf.ts'

test('a mode or a theme is Norwegian where it is common and a platform is left as it is', () => {
  assert.equal(facetName('mode', 'Single player'), 'Enspiller')
  assert.equal(facetName('theme', 'Cyberpunk'), 'Cyberpunk')
  assert.equal(facetName('platform', 'Nintendo Switch'), 'Nintendo Switch')
})

test('a game lists only the kinds it has', () => {
  const facets = { ...noFacets(), platform: ['PC'], mode: ['Single player', 'Multiplayer'] }
  assert.deepEqual(facetFacts(facets).filter(([, names]) => names !== null), [['Plattformer', 'PC'], ['Spillmoduser', 'Enspiller, Flerspiller']])
})

test('the time to beat is told for a game that ends and not for an endless one', () => {
  assert.equal(toBeatLine({ hastily: 36, normally: 70.8, completely: 120.4 }), 'ca. 71 timer (rask 36, alt 120)')
  assert.equal(toBeatLine({ hastily: null, normally: 8.5, completely: null }), 'ca. 8,5 timer')
  assert.equal(toBeatLine({ hastily: 1, normally: 420.2, completely: 1698 }), null)
  assert.equal(toBeatLine(null), null)
})

test('a book lists its pages and its author\'s country, and only what it has', () => {
  assert.deepEqual(bookFacts({ pages: 320, authorCountry: 'USA' }), [['Sider', '320'], ['Forfatterland', 'USA']])
  assert.deepEqual(bookFacts({ pages: null, authorCountry: null }), [['Sider', null], ['Forfatterland', null]])
})
