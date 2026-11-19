import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { buildLookup } from './entity-lookup.ts'
import { topArtistParts } from './top-artists.ts'
import type { EntitySummary } from '@/lib/types'

const artist = (name: string, cover: string | null): EntitySummary => ({ kind: 'artist', slug: `artist-${name}`, name, artist: '', cover, plays: 1 })

const lookup = buildLookup([artist('Beyoncé', '/covers/beyonce.jpg'), artist('Shygirl', null), { kind: 'album', slug: 'album-Lemonade', name: 'Orville Peck', artist: 'Someone', cover: '/covers/album.jpg', plays: 1 }])

test('each artist keeps its place and its count, and brings the picture its page has', () => {
  const parts = topArtistParts([{ artist: 'Beyoncé', plays: 42 }, { artist: 'Shygirl', plays: 12 }], lookup)
  assert.deepEqual(parts, [
    { artist: 'Beyoncé', plays: 42, image: '/covers/beyonce.jpg' },
    { artist: 'Shygirl', plays: 12, image: null },
  ])
})

test('an artist with no page, or a name that is only an album, has no picture and is still named', () => {
  const parts = topArtistParts([{ artist: 'Unknown', plays: 3 }, { artist: 'Orville Peck', plays: 17 }], lookup)
  assert.deepEqual(parts.map((part) => [part.artist, part.plays, part.image]), [['Unknown', 3, null], ['Orville Peck', 17, null]])
})

test('nothing in, nothing out, and the lookup of a page that has no index gives none', () => {
  assert.deepEqual(topArtistParts([], lookup), [])
  assert.deepEqual(topArtistParts([{ artist: 'Beyoncé', plays: 1 }], () => undefined), [{ artist: 'Beyoncé', plays: 1, image: null }])
})
