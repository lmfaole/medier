/**
 * The concerts of the music app: the calendar's (`music_concert_event`, upcoming and past, with the Immich album of the photos)
 * and the older ones of the hand-kept log (`music_concert`) that the calendar has no event for. Each is a slug a page can open,
 * its venue's slug, the photos kept of its album and the artist the title names, when it is one the owner has heard
 * (`lib/concert-artist.ts`; the artist has a card only when it has a page).
 */

import { queryRows } from '@designsystem/config/d1-query'
import { slugify } from '@designsystem/content/slug'
import * as v from 'valibot'

import { artistOf, candidatesOf } from '../lib/concert-artist.ts'
import { photoPath } from './concert-photo.ts'
import { entities } from './entities.ts'

/** The calendar's concerts, then the log's that the calendar has not: the same day and title is one concert. */
const CONCERTS_SQL = `SELECT replace(uid, '@lmfaole.party', '') AS slug, on_date, at_time, title, venue, album_id FROM music_concert_event
  UNION ALL
  SELECT 'logg-' || id, watched_on, NULL, title, place, (SELECT album_id FROM music_concert_album WHERE watched_on = logged.watched_on AND lower(title) = lower(logged.title)) FROM music_concert AS logged
  WHERE watched_on IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM music_concert_event WHERE on_date = logged.watched_on AND lower(title) = lower(logged.title))
  ORDER BY on_date DESC, at_time DESC`

/** The setlists setlist.fm has of the concerts (`music-sync setlist-songs`), a row a song in the order played. */
const SETLISTS_SQL = 'SELECT watched_on, title, artist, url, encore, song, cover FROM music_concert_setlist ORDER BY watched_on, title, artist, position'

const SetlistRow = v.object({ watched_on: v.string(), title: v.string(), artist: v.string(), url: v.string(), encore: v.number(), song: v.string(), cover: v.nullable(v.string()) })

/** Where the venues are (`.data/music-venues.csv`): a venue's text and its place. */
const VENUES_SQL = 'SELECT venue, lat, lon FROM music_venue'

const VenueRow = v.object({ venue: v.string(), lat: v.number(), lon: v.number() })

const PHOTOS_SQL = 'SELECT album_id, file, is_video FROM music_concert_media ORDER BY album_id, position'

/** The names heard in the listens among the texts a concert title may name an artist by (`?` is a JSON array): an artist with no page of its own is still one the owner has heard. */
const HEARD_SQL = 'SELECT DISTINCT artist_name FROM listens WHERE lower(artist_name) IN (SELECT value FROM json_each(?))'

/** The artists the owner saw at a concert, written by hand: a concert is a day and a title, and may have none, one or many. */
const ACTS_SQL = 'SELECT watched_on, title, artist, billing FROM music_concert_act ORDER BY id'

const ActRow = v.object({ watched_on: v.string(), title: v.string(), artist: v.string(), billing: v.nullable(v.picklist(['headliner', 'support'])) })

const PhotoRow = v.object({ album_id: v.string(), file: v.string(), is_video: v.number() })

const HeardRow = v.object({ artist_name: v.string() })

const ConcertRow = v.object({
  slug: v.string(),
  on_date: v.string(),
  at_time: v.nullable(v.string()),
  title: v.string(),
  venue: v.nullable(v.string()),
  album_id: v.nullable(v.string()),
})

/** An artist the owner saw at a concert. */
export interface ConcertAct {
  name: string
  billing: 'headliner' | 'support' | null
}

/** What an artist played at a concert, as setlist.fm has it; `url` is the setlist's page on the site. */
export interface ConcertSetlist {
  artist: string
  url: string
  songs: { name: string; cover: string | null; encore: number }[]
}

/** Where a concert was: the place, and the map kept of it, a picture of this app. */
export interface ConcertPlace {
  lat: number
  lon: number
  map: string
}

export interface Concert {
  slug: string
  /** `YYYY-MM-DD`. */
  on: string
  /** `HH:MM`, or none for a whole day. */
  at: string | null
  title: string
  venue: string | null
  venueSlug: string | null
  /** From today on, which the server says so that a page does not need a clock. */
  upcoming: boolean
  albumId: string | null
  /** The photos and videos kept of the album, as pictures of this app, the favourites first. */
  photos: { url: string; video: boolean }[]
  /** The name of the artist the concert is named for. */
  artist: string | null
  /** The artists seen there, in the order the log writes them: a festival day or a night with a support act has several. */
  acts: ConcertAct[]
  /** Where the venue is, when the owner's venue list has it. */
  place: ConcertPlace | null
  /** The setlists the site has, in the order of the acts. */
  setlists: ConcertSetlist[]
}

/** Every concert, the newest day first, with `today` (`YYYY-MM-DD`) telling the upcoming from the seen. */
export async function concerts(database: D1Database, today: string): Promise<{ concerts: Concert[] }> {
  const [rows, index, photoRows, actRows, venueRows, setlistRows] = await Promise.all([queryRows(database, CONCERTS_SQL, ConcertRow), entities(database), queryRows(database, PHOTOS_SQL, PhotoRow), queryRows(database, ACTS_SQL, ActRow), queryRows(database, VENUES_SQL, VenueRow), queryRows(database, SETLISTS_SQL, SetlistRow)])
  const heard = await queryRows(database, HEARD_SQL, HeardRow, JSON.stringify(rows.flatMap((row) => candidatesOf(row.title))))
  const artists = new Map([...heard.map((row) => row.artist_name), ...index.filter((entity) => entity.kind === 'artist').map((entity) => entity.name)].map((name) => [name.toLowerCase(), name]))
  const actsOf = (on: string, title: string): ConcertAct[] =>
    actRows
      .filter((act) => act.watched_on === on && act.title.toLowerCase() === title.toLowerCase())
      .map((act) => ({ name: act.artist, billing: act.billing }))
  const setlistsOf = (on: string, title: string, acts: ConcertAct[]): ConcertSetlist[] => {
    const found = new Map<string, ConcertSetlist>()
    for (const row of setlistRows.filter((candidate) => candidate.watched_on === on && candidate.title.toLowerCase() === title.toLowerCase())) {
      const setlist = found.get(row.artist) ?? { artist: row.artist, url: row.url, songs: [] }
      setlist.songs.push({ name: row.song, cover: row.cover, encore: row.encore })
      found.set(row.artist, setlist)
    }
    const order = (artist: string): number => acts.findIndex((act) => act.name === artist)
    return [...found.values()].toSorted((a, b) => order(a.artist) - order(b.artist))
  }
  const places = new Map(venueRows.map((row) => [row.venue, { lat: row.lat, lon: row.lon, map: photoPath(`venue-${slugify(row.venue)}.webp`) }]))
  const photos = new Map<string, { url: string; video: boolean }[]>()
  for (const { album_id, file, is_video } of photoRows) photos.set(album_id, [...(photos.get(album_id) ?? []), { url: photoPath(file), video: is_video === 1 }])
  return {
    concerts: rows.map((row) => {
      const acts = actsOf(row.on_date, row.title)
      return {
        slug: row.slug,
        on: row.on_date,
        at: row.at_time,
        title: row.title,
        venue: row.venue,
        venueSlug: row.venue === null ? null : slugify(row.venue) || null,
        upcoming: row.on_date >= today,
        albumId: row.album_id,
        photos: row.album_id === null ? [] : (photos.get(row.album_id) ?? []),
        artist: artistOf(row.title, artists),
        acts,
        place: row.venue === null ? null : (places.get(row.venue) ?? null),
        setlists: setlistsOf(row.on_date, row.title, acts),
      }
    }),
  }
}
