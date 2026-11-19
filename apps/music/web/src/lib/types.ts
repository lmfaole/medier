// Mirrors the JSON shape built by `src/api.ts` in the Worker. Keep this the
// single place that knows the wrapped-view shape; everything else imports it.

import type { Ownership } from '@designsystem/ui/lib/ownership'

/** One week (Monday to Sunday, UTC): the plays, how they differ from the week before and the artists that led. */
export interface WeekSummary {
  /** The Monday it starts, `YYYY-MM-DD`. */
  start: string
  plays: number
  /** Percent more (positive) or fewer (negative) plays than the week before; `null` when that week had none or is not in the answer. */
  change: number | null
  /** The week that is not over yet: its plays so far are not compared as a whole week. */
  ongoing: boolean
  topArtists: { artist: string; plays: number }[]
}

/** The latest weeks, newest first. */
export interface WeeksData {
  weeks: WeekSummary[]
}

/** One month or one year (UTC), as a week is: the plays, how they differ from the one before and the artists that led. */
export interface SpanSummary {
  /** The first day it covers, `YYYY-MM-DD`: the 1st of the month, 1 January of the year. */
  start: string
  plays: number
  /** Percent more or fewer plays than the one before; `null` when that had none, is not in the answer, or this one is not over. */
  change: number | null
  /** Not over yet: its plays so far are not compared as a whole. */
  ongoing: boolean
  topArtists: { artist: string; plays: number }[]
}

/** The latest months, newest first. */
export interface MonthsData {
  months: SpanSummary[]
}

/** Every year with listens, newest first. */
export interface YearsData {
  years: SpanSummary[]
}

/** What a sheet can be opened for. */
export type EntityKind = 'artist' | 'album' | 'song'

/** One entry of the index of everything that has a sheet: enough to link to it and to show its picture. */
export interface EntitySummary {
  kind: EntityKind
  slug: string
  name: string
  /** The artist of an album or a song; empty for an artist. */
  artist: string
  cover: string | null
  plays: number
}

/** What every sheet says: when it began, how long, and plays per year. */
interface EntityBase {
  slug: string
  name: string
  cover: string | null
  /** A colour of the cover (`#rrggbb`) for the page's charts: the artist's most played album's. */
  accent: string | null
  plays: number
  minutes: number
  /** Unix seconds. */
  firstAt: number
  lastAt: number
  /** Plays per year with plays, oldest first. */
  years: { year: number; plays: number }[]
  /** What the collection says the owner has or wants of it, or none. */
  ownership: Ownership | null
}

export interface ArtistPage extends EntityBase {
  kind: 'artist'
  area: string | null
  /** When the artist was active, from MusicBrainz; none where it has no dates. */
  beginYear: number | null
  endYear: number | null
  ended: boolean
  /** The artist's picture from Wikimedia Commons, as the app serves it, where it comes from and the page that credits it. */
  image: string | null
  imageSource: string | null
  imageCredit: string | null
  /** Plays per year split by the most played albums; `null` is every other album, oldest year first. */
  albumYears: { album: string | null; year: number; plays: number }[]
  /** Plays per month (`YYYY-MM`) with plays, oldest first. */
  months: { month: string; plays: number }[]
  /** When each album came out (`YYYY`, `YYYY-MM` or `YYYY-MM-DD`), oldest first. */
  releases: { album: string; date: string }[]
  /** The most days in a row with a play, and the day that run began. */
  streakDays: number
  streakStart: string | null
  topTracks: { track: string; plays: number; cover: string | null }[]
  topAlbums: { album: string; plays: number; cover: string | null }[]
  /** The colour of each of the most played albums' covers, for the chart that divides the years by album. */
  albumColors: { album: string; color: string }[]
  genres: { genre: string; plays: number }[]
  firstTrack: { track: string; at: number } | null
  /** Everyone heard with on one recording, the most played together first, with the tracks they share. */
  collaborations: { artist: string; plays: number; tracks: { track: string; plays: number }[] }[]
  /** Artists the library files under the same genres, the most alike first; `score` is 0 to 1. */
  similar: { artist: string; score: number }[]
  /** Where the news names the artist: items a year and the newest few, from the artist's own news search. */
}

/** One track of an album, with what is known of it: a fact nothing knows is left out. */
export interface AlbumTrack {
  track: string
  plays: number
  disc?: number | undefined
  position?: number | undefined
  /** Who MusicBrainz credits the track to, when that is not the album's artist: «Band feat. Guest». */
  credit?: string | undefined
  lengthMs?: number | undefined
  firstAt?: number | undefined
  lastAt?: number | undefined
  /** Only when it is not the album's own year: a single or a bonus track. */
  releaseYear?: number | undefined
  loved: boolean
  genres: string[]
}

export interface AlbumPage extends EntityBase {
  kind: 'album'
  /** A photo of the artist for behind the head, as the app serves it. */
  banner: string | null
  artist: string
  releaseYear: number | null
  /** «Live, Album», «Singel»: the kind of release, and the label that put it out, where MusicBrainz says. */
  releaseKind: string | null
  label: string | null
  /** How many different tracks of it were heard; `tracks` lists them. */
  tracksHeard: number
  /** In the album's order with every track when the tracklist is known (a track not played has no plays), else the most played first. */
  tracks: AlbumTrack[]
}

export interface SongPage extends EntityBase {
  kind: 'song'
  banner: string | null
  artist: string
  album: string | null
  releaseYear: number | null
  releaseKind: string | null
  label: string | null
  /** Plays by hour of the day, UTC, index 0 to 23. */
  hours: number[]
  busiestDay: { day: string; plays: number } | null
  genres: { genre: string; plays: number }[]
  /** The artist's other most played songs. */
  siblings: { track: string; plays: number }[]
}

/** A work that is in the collection and was never played: no plays to count, only what the collection says. */
export interface CollectionPage {
  kind: 'collection'
  /** The kind of work it is, which names its words: `artist`, `album` or `song`. */
  of: EntityKind
  slug: string
  name: string
  /** Who made it; empty for an artist. */
  artist: string
  releaseYear: number | null
  ownership: Ownership
  /** What Discogs says of the copies, where the collection has them from there. */
  genres: string[]
  styles: string[]
  label: string | null
  catalogue: string | null
  /** The Cover Art Archive thumbnail of the release, where it has one. */
  cover: string | null
  /** An album's tracks in its order, from MusicBrainz, none of them played; empty for an artist, a song or an album with no tracklist. */
  tracks: AlbumTrack[]
}

export type EntityPage = ArtistPage | AlbumPage | SongPage | CollectionPage

/** What the history answers: every listen of one month, newest first, and the months to choose from. */
export interface HistoryData {
  month: string
  months: string[]
  listens: RecentListen[]
}

/** One recent listen. */
export interface RecentListen {
  /** Unix seconds. */
  at: number
  track: string
  artist: string
  release: string | null
  cover: string | null
}


/** A picture of a concert's album, as a picture of this app; `video` where it is the picture of a video, which plays in Immich. */
export interface ConcertPhoto {
  url: string
  video: boolean
}

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

/** Where a concert was, and the map kept of it as a picture of this app. */
export interface ConcertPlace {
  lat: number
  lon: number
  map: string
}

/** A concert of the Konserter calendar or the older log, as `server/concerts.ts` answers it. */
export interface ConcertSummary {
  slug: string
  /** `YYYY-MM-DD`. */
  on: string
  /** `HH:MM`, or none for a whole day. */
  at: string | null
  title: string
  venue: string | null
  venueSlug: string | null
  upcoming: boolean
  albumId: string | null
  /** The favourites of the album in Immich, as pictures of this app. */
  photos: ConcertPhoto[]
  artist: string | null
  /** The artists seen there: a festival day or a night with a support act has several. */
  acts: ConcertAct[]
  place: ConcertPlace | null
  setlists: ConcertSetlist[]
}
