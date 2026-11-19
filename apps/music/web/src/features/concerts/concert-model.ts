// One concert's page as DATA (`/konsert/<slug>`), in the shape `EntityView` draws: the photo and the name as the head, the map, the
// setlists folded for a festival, who played, and the photos of the concert's album. No React; links come from the caller.

import { formatDay } from '@designsystem/intl/listening'
import type { EntityModel, Row, Section, Text, Tile } from '@designsystem/ui/lib/entity-model'

import { actOf, concertLabel, concertWho, isFestival } from '../../lib/concert-label.ts'
import { albumHref } from '../../lib/immich.ts'
import type { ArtistPage, ConcertSetlist, ConcertSummary } from '../../lib/types.ts'

/** From this many setlists on, they are folded under the artists' names; fewer are shown open, each under its artist. */
export const FOLD_FROM = 5

const OSM = 'https://www.openstreetmap.org/'

const songText = (song: ConcertSetlist['songs'][number]): string => `${song.cover === null ? song.name : `${song.name} (cover av ${song.cover})`}${song.encore > 0 ? ' · ekstranummer' : ''}`

/** What stands under the day: the venue, or the festival; the artist's billing when it was support. */
export function concertSubtitle(concert: ConcertSummary, artist: string): string | null {
  const place = isFestival(concert) ? concert.title : concert.venue
  const support = actOf(concert, artist)?.billing === 'support' ? 'support' : null
  return [place, support].filter((part) => part !== null).join(' · ') || null
}

/** The concerts of one artist as gallery tiles: a picture from the concert with the day and the venue under it. */
export function concertTiles(concerts: readonly ConcertSummary[], artist: string, hrefOf: (slug: string) => string) {
  return concerts.map((concert) => ({ name: formatDay(concert.on), href: hrefOf(concert.slug), cover: concert.photos[0]?.url ?? null, ratio: 'square' as const, subtitle: concertSubtitle(concert, artist) }))
}

/** The numbers of a concert: who played, how many songs the setlists hold and how many pictures the album has. */
function concertTilesOf(concert: ConcertSummary): Tile[] {
  const songs = concert.setlists.reduce((sum, setlist) => sum + setlist.songs.length, 0)
  const pictures = concert.albumId === null ? 0 : concert.photos.length
  return [
    ...(concert.acts.length === 0 ? [] : [{ label: 'Artister', value: { n: concert.acts.length } }]),
    ...(songs === 0 ? [] : [{ label: 'Låter', value: { n: songs } }]),
    ...(pictures === 0 ? [] : [{ label: 'Bilder', value: { n: pictures } }]),
  ]
}

/** A venue's page (`/venue/<slug>`): the concerts there, the upcoming ones first and then the ones that have been, newest first. */
export function venueModel(name: string, concerts: readonly ConcertSummary[], hrefOf: (slug: string) => string): EntityModel {
  const rowsOf = (list: readonly ConcertSummary[]): Row[] => list.map((concert) => ({ name: { text: concertLabel(concert), href: hrefOf(concert.slug) }, detail: formatDay(concert.on) }))
  const upcoming = concerts.filter((concert) => concert.upcoming).toReversed()
  const been = concerts.filter((concert) => !concert.upcoming)
  const days = been.map((concert) => concert.on).toSorted()
  const first = days[0]
  const last = days.at(-1)
  return {
    kind: 'place',
    kindLabel: 'Venue',
    name,
    tiles: [
      { label: 'Konserter', value: { n: been.length } },
      ...(upcoming.length === 0 ? [] : [{ label: 'Kommende', value: { n: upcoming.length } }]),
      ...(first === undefined || last === undefined ? [] : first === last ? [{ label: 'Dato', value: { day: first } }] : [{ label: 'Første', value: { day: first } }, { label: 'Siste', value: { day: last } }]),
    ],
    sections: [
      { id: 'upcoming', title: 'Kommende', band: 'mine', kind: 'rows', rows: rowsOf(upcoming) },
      { id: 'concerts', title: 'Konserter', band: 'mine', kind: 'rows', rows: rowsOf(been) },
    ],
  }
}

export function toModel(concert: ConcertSummary, artist: ArtistPage | null, artistHref: (name: string) => string | undefined): EntityModel {
  const day = `${formatDay(concert.on)}${concert.at === null ? '' : ` ${concert.at}`}`
  const who = concertWho(concert)
  const sections: Section[] = []
  if (concert.place !== null) {
    const { lat, lon } = concert.place
    sections.push({ id: 'plassering', title: 'Plassering', kind: 'map', src: concert.place.map, link: { text: `${concert.venue ?? 'Kart'} i OpenStreetMap`, href: `${OSM}?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}` }, credit: { text: 'OpenStreetMap-bidragsytere', href: `${OSM}copyright` } })
  }
  sections.push({
    id: 'setliste',
    title: 'Setliste',
    kind: 'fold',
    groups: concert.setlists.map((setlist) => ({ summary: `${setlist.artist} (${setlist.songs.length} låter)`, heading: setlist.artist, items: setlist.songs.map(songText) })),
    source: concert.setlists.map((setlist): Text => ({ text: concert.setlists.length === 1 ? 'setlist.fm' : setlist.artist, href: setlist.url })),
    openBelow: FOLD_FROM,
    head: ['Låt', 'Nummer'],
  })
  sections.push({
    id: 'spilte',
    title: 'Spilte',
    kind: 'text',
    lines: concert.acts.map((act): Text => {
      const text = `${act.name}${act.billing === 'support' ? ' (support)' : ''}`
      const href = artistHref(act.name)
      return href === undefined ? text : { text, href }
    }),
  })
  sections.push({ id: 'bilder', title: 'Bilder', band: 'mine', kind: 'photos', photos: concert.albumId === null ? [] : concert.photos, href: concert.albumId === null ? '' : albumHref(concert.albumId) })
  return {
    kind: 'concert',
    ...(concert.upcoming ? { kindLabel: 'Kommende konsert' } : {}),
    name: concertLabel(concert),
    tiles: concertTilesOf(concert),
    picture: { banner: concert.photos.find((photo) => !photo.video)?.url ?? artist?.image ?? artist?.cover ?? null },
    subtitle: (isFestival(concert) ? [concert.venue, day] : [concert.title === who ? null : concert.title, day]).filter((line): line is string => line !== null),
    sections,
  }
}
