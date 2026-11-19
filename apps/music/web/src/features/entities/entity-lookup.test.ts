import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { buildLookup, lookupFor } from './entity-lookup.ts'
import type { EntitySummary } from '@/lib/types'

const entry = (kind: EntitySummary['kind'], name: string, artist: string): EntitySummary => ({
  kind,
  slug: `${kind}-${name}`,
  name,
  artist,
  cover: null,
  plays: 1,
})

const lookup = buildLookup([entry('artist', 'Beyoncé', ''), entry('album', 'Lemonade', 'Beyoncé'), entry('song', 'Lemonade', 'Someone Else')])

test('an artist is found by its name alone', () => {
  assert.equal(lookup('artist', 'Beyoncé')?.slug, 'artist-Beyoncé')
  assert.equal(lookup('artist', 'Beyoncé', 'ignored')?.slug, 'artist-Beyoncé')
})

test('an album or a song is found by its name and its artist, and the same name of another kind is another thing', () => {
  assert.equal(lookup('album', 'Lemonade', 'Beyoncé')?.slug, 'album-Lemonade')
  assert.equal(lookup('song', 'Lemonade', 'Someone Else')?.slug, 'song-Lemonade')
  assert.equal(lookup('song', 'Lemonade', 'Beyoncé'), undefined)
  assert.equal(lookup('album', 'Lemonade'), undefined)
})

test('the same index is built into a lookup once, however many links ask', () => {
  const index = [entry('artist', 'Beyoncé', '')]
  assert.equal(lookupFor(index), lookupFor(index))
  assert.notEqual(lookupFor(index), lookupFor([...index]))
  assert.equal(lookupFor(index)('artist', 'Beyoncé')?.slug, 'artist-Beyoncé')
})
