// An artist's, an album's, a song's or a collection page as DATA, in the shape `EntityView` draws. No React: a plain function of the
// page's answer and of what the caller knows of links and pictures (`LinkContext`, built from the index of what has a page), so
// the model carries finished `{ text, href }` and a test passes a fake lookup.

import { creditName } from '@designsystem/config/artist-image'
import { formatHoursAndMinutes, formatShortDay, formatTimestampDay } from '@designsystem/intl/listening'
import { KIND_LABEL, type EntityModel, type Fact, type Row, type Section, type Text, type Tile } from '@designsystem/ui/lib/entity-model'
import { ownershipRating } from '@designsystem/ui/lib/ownership'

import { concertTiles } from '../concerts/concert-model.ts'
import { albumLength, trackInfo, trackNumber } from '../../lib/track-line.ts'
import type { AlbumPage, AlbumTrack, ArtistPage, CollectionPage, ConcertSummary, EntityKind, EntityPage, SongPage } from '../../lib/types.ts'

/** What a page needs to know of the world: where a name's own page is (none: plain text), the picture the index has for it, and a concert's page. */
export interface LinkContext {
  href: (kind: EntityKind, name: string, artist?: string) => string | undefined
  cover: (kind: EntityKind, name: string, artist?: string) => string | null
  concertHref: (slug: string) => string
}

/** What the front of an artist's page lists of each: the most played. */
export const TOP = 5
/** How many of the most alike artists are shown. */
export const SIMILAR = 3
const OTHER_ALBUMS = 'Andre'

const link = (ctx: LinkContext, kind: EntityKind, name: string, artist?: string): Text => {
  const href = ctx.href(kind, name, artist)
  return href === undefined ? name : { text: name, href }
}

/** «1997–» or «1990–2004»: the life-span MusicBrainz has, where it has a start. It is a birth for a person and a start for a group, so no word says which. */
export function activeYears(page: Pick<ArtistPage, 'beginYear' | 'endYear' | 'ended'>): string | null {
  if (page.beginYear === null) return null
  return `${page.beginYear}–${page.ended && page.endYear !== null ? page.endYear : ''}`
}

const lines = (...parts: (Text | null | undefined)[]): Text[] => parts.filter((part): part is Text => part !== null && part !== undefined && part !== '')

const lengthText = (tracks: readonly AlbumTrack[]): string | null => {
  const length = albumLength(tracks)
  return length === null ? null : length.complete ? length.text : `${length.text}+`
}

/** The tiles every music page opens with, then those only that kind has. */
function playTiles(page: { plays: number; minutes: number; firstAt: number; lastAt: number }, more: readonly Tile[] = []): Tile[] {
  return [
    { label: 'Avspillinger', value: { n: page.plays } },
    ...(page.minutes > 0 ? [{ label: 'Tid', value: { minutes: page.minutes } }] : []),
    { label: 'Første', value: { ts: page.firstAt } },
    { label: 'Sist', value: { ts: page.lastAt } },
    ...more,
  ]
}

const genreText = (genres: readonly { genre: string }[]): string | null => (genres.length === 0 ? null : genres.map((entry) => entry.genre).join(', '))

/** Plays per year; given the plays of each album a column is divided into them, each in the colour of its album's cover. */
export function yearsChart(page: EntityPage & { kind: 'artist' | 'album' | 'song' }): Section {
  const albumYears = page.kind === 'artist' ? page.albumYears : []
  const albums = [...new Set(albumYears.flatMap((entry) => (entry.album === null ? [] : [entry.album])))]
  const series = albumYears.some((entry) => entry.album === null) ? [...albums, OTHER_ALBUMS] : albums
  const base = { id: 'years', title: 'Avspillinger per år', kind: 'chart', valueLabel: 'Avspillinger', ariaLabel: `Avspillinger av ${page.name} per år`, series: page.years.map((entry) => ({ label: String(entry.year), value: entry.plays })), color: page.accent } as const
  if (page.kind !== 'artist' || albums.length === 0) return { ...base, height: 168 }
  const colors = page.albumColors
  return {
    ...base,
    height: 200,
    stacked: {
      data: albumYears.map((entry) => ({ label: String(entry.year), series: entry.album ?? OTHER_ALBUMS, value: entry.plays })),
      series,
      colors: series.map((name) => colors.find((entry) => entry.album === name)?.color ?? null),
    },
  }
}

function songRow(ctx: LinkContext, artist: string, track: { track: string; plays: number }, over: Partial<Row> = {}): Row {
  return { name: link(ctx, 'song', track.track, artist), picture: ctx.cover('song', track.track, artist), count: { times: track.plays }, ...over }
}

/** An album's tracks in its order: a track never played is `muted`, a loved one has its heart, its facts are in the «i» popover. */
export function trackRows(ctx: LinkContext, tracks: readonly AlbumTrack[], artist: string, cover: string | null, played: boolean): Row[] {
  const hasDiscs = tracks.some((track) => (track.disc ?? 1) > 1)
  return tracks.map((track) => {
    const facts: Fact[] = trackInfo(track, hasDiscs).map(([label, value]) => [label, value])
    const number = trackNumber(track, hasDiscs)
    return {
      name: link(ctx, 'song', track.track, artist),
      picture: cover ?? ctx.cover('song', track.track, artist),
      ...(number === null ? {} : { detail: number }),
      ...(facts.length === 0 ? {} : { info: facts }),
      ...(played ? { loved: track.loved } : {}),
      count: { times: played ? track.plays : 0 },
      muted: !played || track.plays === 0,
    }
  })
}

function artistModel(page: ArtistPage, ctx: LinkContext, concerts: readonly ConcertSummary[]): EntityModel {
  const streak = page.streakStart === null ? 'Ingen' : `${page.streakDays} dager`
  return {
    kind: 'artist',
    name: page.name,
    picture: { banner: page.image ?? page.cover },
    subtitle: lines(page.area, activeYears(page), `${page.years[0]?.year ?? ''}–${page.years.at(-1)?.year ?? ''} hos meg`),
    facts: [
      ['Høres ut som', genreText(page.genres)],
      ['Bilde', page.imageCredit === null ? null : { text: creditName(page.imageCredit), href: page.imageCredit }],
    ],
    tiles: playTiles(page, [
      { label: 'Lengste rekke', value: { words: streak }, ...(page.streakStart === null ? {} : { note: `på rad, fra ${formatShortDay(page.streakStart)}` }) },
      ...(page.firstTrack ? [{ label: 'Det begynte med', value: { words: page.firstTrack.track }, note: formatTimestampDay(page.firstTrack.at) }] : []),
    ]),
    ownership: page.ownership,
    sections: [
      yearsChart(page),
      { id: 'albums', title: 'Album', kind: 'rows', rows: page.topAlbums.map((album) => ({ name: link(ctx, 'album', album.album, page.name), picture: album.cover ?? ctx.cover('album', album.album, page.name), count: { times: album.plays } })) },
      { id: 'songs', title: 'Låter', kind: 'rows', rows: page.topTracks.slice(0, TOP).map((track) => ({ name: link(ctx, 'song', track.track, page.name), picture: track.cover ?? ctx.cover('song', track.track, page.name), count: { times: track.plays } })) },
      {
        id: 'collaborations',
        title: 'Samarbeid',
        kind: 'rows',
        rows: page.collaborations.slice(0, TOP).map((other) => ({
          name: link(ctx, 'artist', other.artist),
          picture: ctx.cover('artist', other.artist),
          detail: other.tracks.map((track) => (track.plays > 1 ? `${track.track} (${track.plays})` : track.track)).join(', '),
          count: { times: other.plays },
        })),
      },
      {
        id: 'similar',
        title: 'Ligner',
        kind: 'gallery',
        items: page.similar.slice(0, SIMILAR).map((other) => ({ name: other.artist, href: ctx.href('artist', other.artist) ?? null, cover: ctx.cover('artist', other.artist), ratio: 'square', subtitle: `${Math.round(other.score * 100)} % lik` })),
      },
      { id: 'concerts', title: 'Konserter', kind: 'gallery', items: concertTiles(concerts, page.name, ctx.concertHref) },
    ],
  }
}

function albumModel(page: AlbumPage, ctx: LinkContext): EntityModel {
  return {
    kind: 'album',
    name: page.name,
    picture: { cover: page.cover, shape: 'square' },
    facts: [
      ['Artist', link(ctx, 'artist', page.artist)],
      ['Utgitt', page.releaseYear === null ? null : String(page.releaseYear)],
      ['Type', page.releaseKind],
      ['Plateselskap', page.label],
      ['Lyttet tid', formatHoursAndMinutes(page.minutes)],
      ['Lengde', lengthText(page.tracks)],
      ['Låter', String(page.tracks.length)],
    ],
    tiles: playTiles(page),
    ownership: page.ownership,
    sections: [yearsChart(page), { id: 'tracks', title: 'Låter', kind: 'rows', rows: trackRows(ctx, page.tracks, page.artist, page.cover, true) }],
  }
}

function songModel(page: SongPage, ctx: LinkContext): EntityModel {
  return {
    kind: 'song',
    name: page.name,
    picture: { banner: page.banner ?? page.cover },
    subtitle: lines(link(ctx, 'artist', page.artist), page.album === null ? null : link(ctx, 'album', page.album, page.artist), page.releaseYear === null ? null : String(page.releaseYear), page.releaseKind, page.label),
    facts: [['Merket', genreText(page.genres)]],
    tiles: playTiles(page, page.busiestDay ? [{ label: 'Travleste dag', value: { words: formatShortDay(page.busiestDay.day) }, note: `${page.busiestDay.plays} avspillinger på én dag` }] : []),
    ownership: page.ownership,
    sections: [
      yearsChart(page),
      { id: 'hours', title: 'Når du spiller den', kind: 'chart', valueLabel: 'Avspillinger', ariaLabel: `Avspillinger av ${page.name} per time på døgnet`, series: page.hours.map((plays, hour) => ({ label: String(hour).padStart(2, '0'), value: plays })), color: page.accent, height: 120, labelEvery: 3 },
      { id: 'siblings', title: `Mer av ${page.artist}`, kind: 'rows', rows: page.siblings.map((sibling) => songRow(ctx, page.artist, sibling)) },
    ],
  }
}

function collectionModel(page: CollectionPage, ctx: LinkContext): EntityModel {
  const rating = ownershipRating(page.ownership)
  return {
    kind: 'collection',
    kindLabel: KIND_LABEL[page.of],
    name: page.name,
    picture: { banner: page.cover },
    subtitle: page.of === 'artist' ? [] : lines(link(ctx, 'artist', page.artist), page.releaseYear === null ? null : String(page.releaseYear)),
    facts: [
      ['Sjanger', page.genres.join(', ') || null],
      ['Stil', page.styles.join(', ') || null],
      ['Plateselskap', page.label],
      ['Katalognummer', page.catalogue],
      ['Lengde', lengthText(page.tracks)],
      ['Låter', page.tracks.length === 0 ? null : String(page.tracks.length)],
    ],
    rating: rating === null ? null : { value: rating, scale: 5 },
    ownership: page.ownership,
    sections: [{ id: 'tracks', title: 'Låter', kind: 'rows', rows: trackRows(ctx, page.tracks, page.artist, page.cover, false) }],
  }
}

/** The page of an artist, an album, a song or a work only in the collection; `concerts` are those the artist was at. */
export function toModel(page: EntityPage, ctx: LinkContext, concerts: readonly ConcertSummary[] = []): EntityModel {
  switch (page.kind) {
    case 'artist':
      return artistModel(page, ctx, concerts)
    case 'album':
      return albumModel(page, ctx)
    case 'song':
      return songModel(page, ctx)
    case 'collection':
      return collectionModel(page, ctx)
  }
}
