import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { heroOf, visibleSections } from '@designsystem/ui/lib/entity-model'

import type { ConcertSummary } from '../../lib/types.ts'
import { FOLD_FROM, toModel } from './concert-model.ts'

const concert = (over: Partial<ConcertSummary> = {}): ConcertSummary => ({
  slug: 'logg-1',
  on: '2025-08-07',
  at: null,
  title: 'Honningbarna',
  venue: 'Rockefeller',
  venueSlug: null,
  upcoming: false,
  albumId: 'abc',
  photos: [{ url: '/v.webp', video: true }, { url: '/p.webp', video: false }],
  artist: 'Honningbarna',
  acts: [{ name: 'Honningbarna', billing: 'headliner' }, { name: 'Støtte', billing: 'support' }],
  place: { lat: 59.9, lon: 10.7, map: '/maps/x.png' },
  setlists: [{ artist: 'Honningbarna', url: 'https://setlist.fm/a', songs: [{ name: 'A', cover: null, encore: 0 }, { name: 'B', cover: 'Någon', encore: 1 }] }],
  ...over,
})
const href = (name: string) => (name === 'Honningbarna' ? '/artist/h' : undefined)
const sectionOf = (model: ReturnType<typeof toModel>, id: string) => model.sections.find((entry) => entry.id === id)

test('a night is «artist, venue» with its title and day under it, on the first still photo', () => {
  const model = toModel(concert({ title: 'Turné 2025' }), null, href)
  assert.equal(model.name, 'Honningbarna, Rockefeller')
  assert.deepEqual(model.subtitle, ['Turné 2025', '7. august 2025'])
  assert.deepEqual(heroOf(model), { variant: 'banner', picture: '/p.webp' })
  assert.equal(model.kindLabel, undefined)
  assert.equal(toModel(concert({ upcoming: true }), null, href).kindLabel, 'Kommende konsert')
})

test('a festival has its name as the title and the venue in the subtitle', () => {
  const model = toModel(concert({ title: 'Øya 2025', acts: [{ name: 'A', billing: null }], venue: 'Tøyenparken' }), null, href)
  assert.equal(model.name, 'Øya 2025')
  assert.deepEqual(model.subtitle, ['Tøyenparken', '7. august 2025'])
})

test('the setlist is open under few artists and folded from FOLD_FROM on, with its sources and the encore marked', () => {
  const fold = sectionOf(toModel(concert(), null, href), 'setliste')
  assert.equal(fold?.kind, 'fold')
  if (fold?.kind !== 'fold') return
  assert.deepEqual(fold.groups[0]?.items, ['A', 'B (cover av Någon) · ekstranummer'])
  assert.equal(fold.groups[0]?.summary, 'Honningbarna (2 låter)')
  assert.equal(fold.openBelow, FOLD_FROM)
  assert.deepEqual(fold.source, [{ text: 'setlist.fm', href: 'https://setlist.fm/a' }])
  const many = Array.from({ length: FOLD_FROM }, (_, index) => ({ artist: `Akt ${index}`, url: `https://setlist.fm/${index}`, songs: [{ name: 'x', cover: null, encore: 0 }] }))
  const folded = sectionOf(toModel(concert({ setlists: many }), null, href), 'setliste')
  assert.equal(folded?.kind === 'fold' && folded.source?.[1] && typeof folded.source[1] !== 'string' && folded.source[1].text, 'Akt 1')
  assert.equal(visibleSections(toModel(concert({ setlists: [] }), null, href).sections).some((entry) => entry.id === 'setliste'), false)
})

test('the map links to OpenStreetMap, the acts link where the library has the artist, the photos link to the album', () => {
  const model = toModel(concert(), null, href)
  const map = sectionOf(model, 'plassering')
  assert.equal(map?.kind === 'map' && map.src, '/maps/x.png')
  assert.deepEqual(map?.kind === 'map' && map.link, { text: 'Rockefeller i OpenStreetMap', href: 'https://www.openstreetmap.org/?mlat=59.9&mlon=10.7#map=17/59.9/10.7' })
  const acts = sectionOf(model, 'spilte')
  assert.deepEqual(acts?.kind === 'text' && acts.lines, [{ text: 'Honningbarna', href: '/artist/h' }, 'Støtte (support)'])
  const photos = sectionOf(model, 'bilder')
  assert.equal(photos?.kind === 'photos' && photos.href, 'https://bilder.lmfaole.party/albums/abc')
  const bare = visibleSections(toModel(concert({ place: null, albumId: null, acts: [], setlists: [] }), null, href).sections)
  assert.deepEqual(bare, [])
})
