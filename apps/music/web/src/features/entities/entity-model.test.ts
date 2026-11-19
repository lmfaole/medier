import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { heroOf, visibleSections, type Section } from '@designsystem/ui/lib/entity-model'

import type { AlbumPage, AlbumTrack, ArtistPage, CollectionPage, ConcertSummary, SongPage } from '../../lib/types.ts'
import { activeYears, toModel, TOP, type LinkContext } from './entity-model.ts'

const names = new Map([['artist/Beyoncé', '/artist/b'], ['album/Lemonade/Beyoncé', '/album/l'], ['song/Formation/Beyoncé', '/song/f']])
const ctx: LinkContext = {
  href: (kind, name, artist = '') => names.get(kind === 'artist' ? `artist/${name}` : `${kind}/${name}/${artist}`),
  cover: (kind, name) => (kind === 'artist' ? `/covers/${name}.jpg` : null),
  concertHref: (slug) => `/konsert/${slug}`,
}

const base = { slug: 's', cover: '/c.jpg', accent: '#112233', plays: 50, minutes: 120, firstAt: 1_340_000_000, lastAt: 1_780_000_000, years: [{ year: 2012, plays: 20 }, { year: 2013, plays: 30 }], ownership: null }
const section = (sections: readonly Section[], id: string) => sections.find((entry) => entry.id === id)
const track = (over: Partial<AlbumTrack>): AlbumTrack => ({ track: 'Formation', plays: 3, loved: false, genres: [], ...over })

const artist = (over: Partial<ArtistPage> = {}): ArtistPage => ({
  ...base,
  kind: 'artist',
  name: 'Beyoncé',
  area: 'United States',
  beginYear: 1991,
  endYear: null,
  ended: false,
  image: '/artists/x.jpg',
  imageSource: null,
  imageCredit: 'https://commons.wikimedia.org/wiki/File:X.jpg',
  albumYears: [],
  months: [],
  releases: [],
  streakDays: 22,
  streakStart: '2026-06-07',
  topTracks: Array.from({ length: 8 }, (_, index) => ({ track: `Låt ${index}`, plays: 10 - index, cover: null })),
  topAlbums: [{ album: 'Lemonade', plays: 9, cover: null }],
  albumColors: [{ album: 'Lemonade', color: '#00ff00' }],
  genres: [{ genre: 'pop', plays: 3 }, { genre: 'r&b', plays: 2 }],
  firstTrack: { track: 'I Care', at: 1_340_000_000 },
  collaborations: [{ artist: 'Kelly Rowland', plays: 4, tracks: [{ track: 'A', plays: 2 }, { track: 'B', plays: 1 }] }],
  similar: [{ artist: 'Chlöe', score: 0.96 }, { artist: 'Mariah Carey', score: 0.95 }, { artist: 'Whitney', score: 0.94 }, { artist: 'Fourth', score: 0.9 }],
  ...over,
})

test('an artist lists only the TOP most played songs, and its active years end where the artist ended', () => {
  const model = toModel(artist(), ctx)
  const songs = section(model.sections, 'songs')
  assert.equal(songs?.kind === 'rows' && songs.rows.length, TOP)
  assert.equal(activeYears({ beginYear: 1990, endYear: 2004, ended: true }), '1990–2004')
  assert.equal(activeYears({ beginYear: 1997, endYear: null, ended: false }), '1997–')
  assert.equal(activeYears({ beginYear: null, endYear: null, ended: false }), null)
  assert.deepEqual(model.subtitle, ['United States', '1991–', '2012–2013 hos meg'])
})

test('an artist has a streak tile, the first track and a banner head with the genres and the credit as facts', () => {
  const model = toModel(artist(), ctx)
  const streak = model.tiles?.find((tile) => tile.label === 'Lengste rekke')
  assert.deepEqual(streak?.value, { words: '22 dager' })
  assert.match(streak?.note ?? '', /^på rad, fra /)
  assert.equal(model.tiles?.find((tile) => tile.label === 'Det begynte med')?.value && true, true)
  assert.deepEqual(toModel(artist({ streakStart: null, firstTrack: null }), ctx).tiles?.map((tile) => tile.label), ['Avspillinger', 'Tid', 'Første', 'Sist', 'Lengste rekke'])
  assert.equal(heroOf(model).variant, 'banner')
  assert.deepEqual(model.facts?.[0], ['Høres ut som', 'pop, r&b'])
  assert.deepEqual(model.facts?.[1], ['Bilde', { text: 'Wikimedia Commons', href: 'https://commons.wikimedia.org/wiki/File:X.jpg' }])
})

test('similar artists are a gallery of the three closest, «% lik», linked where the index has the artist', () => {
  const model = toModel(artist({ similar: [{ artist: 'Beyoncé', score: 0.964 }, { artist: 'Nobody', score: 0.5 }, { artist: 'Whitney', score: 0.4 }, { artist: 'Fourth', score: 0.1 }] }), ctx)
  const gallery = section(model.sections, 'similar')
  assert.equal(gallery?.kind, 'gallery')
  if (gallery?.kind !== 'gallery') return
  assert.equal(gallery.items.length, 3)
  assert.deepEqual(gallery.items[0], { name: 'Beyoncé', href: '/artist/b', cover: '/covers/Beyoncé.jpg', ratio: 'square', subtitle: '96 % lik' })
  assert.equal(gallery.items[1]?.href, null)
})

test('the albums by album are a stacked chart in the colour of each cover, with the other albums last', () => {
  const albumYears = [{ album: 'Lemonade', year: 2012, plays: 5 }, { album: null, year: 2012, plays: 2 }]
  const chart = section(toModel(artist({ albumYears }), ctx).sections, 'years')
  assert.equal(chart?.kind === 'chart' && chart.stacked?.series.join(), 'Lemonade,Andre')
  assert.deepEqual(chart?.kind === 'chart' && chart.stacked?.colors, ['#00ff00', null])
  const plain = section(toModel(artist(), ctx).sections, 'years')
  assert.equal(plain?.kind === 'chart' && plain.stacked, undefined)
  assert.equal(plain?.kind === 'chart' && plain.color, '#112233')
})

test('an artist without collaborations or concerts shows neither section; with concerts it has a gallery', () => {
  const none = toModel(artist({ collaborations: [], similar: [] }), ctx)
  assert.deepEqual(visibleSections(none.sections).map((entry) => entry.id), ['years', 'albums', 'songs'])
  const concert: ConcertSummary = { slug: 'logg-1', on: '2023-05-29', at: null, title: 'Beyoncé', venue: 'Stadium', venueSlug: null, upcoming: false, albumId: null, acts: [], artist: 'Beyoncé', place: null, setlists: [], photos: [{ url: '/p.webp', video: false }] }
  const gallery = section(toModel(artist(), ctx, [concert]).sections, 'concerts')
  assert.equal(gallery?.kind === 'gallery' && gallery.items[0]?.href, '/konsert/logg-1')
  assert.equal(gallery?.kind === 'gallery' && gallery.items[0]?.subtitle, 'Stadium')
})

const album = (tracks: AlbumTrack[]): AlbumPage => ({ ...base, kind: 'album', name: 'Lemonade', banner: null, artist: 'Beyoncé', releaseYear: 2016, releaseKind: 'Album', label: 'Parkwood', tracksHeard: 2, tracks })

test('an album\'s length ends in + while a track\'s length is unknown, and its facts are in the cover head', () => {
  const complete = toModel(album([track({ lengthMs: 60_000 * 3 }), track({ track: 'B', lengthMs: 60_000 * 4 })]), ctx)
  const partial = toModel(album([track({ lengthMs: 60_000 * 3 }), track({ track: 'B' })]), ctx)
  const lengthOf = (model: typeof complete) => model.facts?.find(([label]) => label === 'Lengde')?.[1]
  assert.equal(lengthOf(complete), '7 min')
  assert.equal(lengthOf(partial), '3 min+')
  assert.equal(lengthOf(toModel(album([track({})]), ctx)), null)
  assert.deepEqual(heroOf(complete), { variant: 'cover', shape: 'square', cover: '/c.jpg', banner: null })
  assert.deepEqual(complete.facts?.[0], ['Artist', { text: 'Beyoncé', href: '/artist/b' }])
})

test('album tracks: never played is muted, loved has its heart, discs are numbered and the facts are the «i»', () => {
  const model = toModel(album([track({ disc: 1, position: 1, plays: 4, loved: true, credit: 'Band feat. X' }), track({ track: 'Hold Up', disc: 2, position: 1, plays: 0 })]), ctx)
  const rows = section(model.sections, 'tracks')
  assert.equal(rows?.kind, 'rows')
  if (rows?.kind !== 'rows') return
  const [first, second] = rows.rows
  assert.deepEqual(first?.name, { text: 'Formation', href: '/song/f' })
  assert.equal(first?.detail, '1-1')
  assert.equal(first?.loved, true)
  assert.equal(first?.muted, false)
  assert.deepEqual(first?.count, { times: 4 })
  assert.deepEqual(first?.info?.find(([label]) => label === 'Kreditt'), ['Kreditt', 'Band feat. X'])
  assert.equal(second?.detail, '2-1')
  assert.equal(second?.muted, true)
  assert.equal(second?.name, 'Hold Up')
  const single = toModel(album([track({ position: 2 })]), ctx).sections.find((entry) => entry.id === 'tracks')
  assert.equal(single?.kind === 'rows' && single.rows[0]?.detail, '2')
})

const song = (over: Partial<SongPage> = {}): SongPage => ({ ...base, kind: 'song', name: 'Formation', banner: '/b.jpg', artist: 'Beyoncé', album: 'Lemonade', releaseYear: 2016, releaseKind: null, label: null, hours: Array.from({ length: 24 }, (_, hour) => (hour === 22 ? 7 : 0)), busiestDay: { day: '2020-01-02', plays: 9 }, genres: [], siblings: [{ track: 'Hold Up', plays: 5 }], ...over })

test('a song has the hours of the day as a chart labelled every third hour, and more of the artist', () => {
  const model = toModel(song(), ctx)
  const hours = section(model.sections, 'hours')
  assert.equal(hours?.kind === 'chart' && hours.series.length, 24)
  assert.deepEqual(hours?.kind === 'chart' && hours.series[3], { label: '03', value: 0 })
  assert.equal(hours?.kind === 'chart' && hours.labelEvery, 3)
  const more = section(model.sections, 'siblings')
  assert.equal(more?.title, 'Mer av Beyoncé')
  assert.deepEqual(model.subtitle?.slice(0, 2), [{ text: 'Beyoncé', href: '/artist/b' }, { text: 'Lemonade', href: '/album/l' }])
  assert.equal(model.tiles?.at(-1)?.label, 'Travleste dag')
  assert.deepEqual(visibleSections(toModel(song({ hours: new Array(24).fill(0), siblings: [] }), ctx).sections).map((entry) => entry.id), ['years'])
})

const collection = (over: Partial<CollectionPage> = {}): CollectionPage => ({ kind: 'collection', of: 'album', slug: 's', name: 'Lemonade', artist: 'Beyoncé', releaseYear: 2016, ownership: { status: 'owned', format: 'vinyl', lines: [{ status: 'owned', format: 'vinyl', addedOn: null, rating: 4.5 }] }, genres: ['Pop'], styles: [], label: null, catalogue: null, cover: '/c.jpg', tracks: [], ...over })

test('a collection with no tracks hides its rows; with tracks every one is muted and unplayed', () => {
  const empty = toModel(collection(), ctx)
  assert.deepEqual(visibleSections(empty.sections), [])
  assert.deepEqual(empty.rating, { value: 4.5, scale: 5 })
  assert.equal(empty.kindLabel, 'Album')
  const full = toModel(collection({ tracks: [track({ position: 1 })] }), ctx)
  const rows = visibleSections(full.sections)[0]
  assert.equal(rows?.kind === 'rows' && rows.rows[0]?.muted, true)
  assert.deepEqual(rows?.kind === 'rows' && rows.rows[0]?.count, { times: 0 })
  assert.equal(toModel(collection({ of: 'artist' }), ctx).subtitle?.length, 0)
})
