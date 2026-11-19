/**
 * The schema of each API file a music page reads (`readApi`), next to the server's loaders: `RESPONSES` must produce what
 * `API` returns, so a loader that changes its answer fails the typecheck here until its schema follows. No SQL is
 * imported, so a page can take this at run time.
 */
import { Text, MaybeText, Count, MaybeCount } from '@designsystem/ui/lib/schema-parts'
import { LibraryWork } from '@designsystem/watch/response-schemas'
import * as v from 'valibot'

import type { ApiResponses } from './api.ts'

const Kind = v.picklist(['artist', 'album', 'song'])
const Years = v.array(v.object({ year: Count, plays: Count }))

const Listen = v.object({ at: Count, track: Text, artist: Text, release: MaybeText, cover: MaybeText })

const Week = v.object({ start: Text, plays: Count, change: v.nullable(v.number()), ongoing: v.boolean(), topArtists: v.array(v.object({ artist: Text, plays: Count })) })

const Span = Week

const Ownership = v.object({
  status: v.picklist(['owned', 'want']),
  format: MaybeText,
  lines: v.array(v.object({ status: v.picklist(['owned', 'want']), format: MaybeText, addedOn: MaybeText, rating: MaybeCount })),
})

const AlbumTrack = v.object({
  track: Text,
  plays: Count,
  disc: v.optional(Count),
  position: v.optional(Count),
  credit: v.optional(Text),
  lengthMs: v.optional(Count),
  firstAt: v.optional(Count),
  lastAt: v.optional(Count),
  releaseYear: v.optional(Count),
  loved: v.boolean(),
  genres: v.array(Text),
})

const Genres = v.array(v.object({ genre: Text, plays: Count }))

const EntityBase = { slug: Text, name: Text, cover: MaybeText, accent: MaybeText, plays: Count, minutes: Count, firstAt: Count, lastAt: Count, years: Years, ownership: v.nullable(Ownership) }

const ArtistPage = v.object({
  ...EntityBase,
  kind: v.literal('artist'),
  area: MaybeText,
  beginYear: MaybeCount,
  endYear: MaybeCount,
  ended: v.boolean(),
  image: MaybeText,
  imageSource: MaybeText,
  imageCredit: MaybeText,
  albumYears: v.array(v.object({ album: MaybeText, year: Count, plays: Count })),
  months: v.array(v.object({ month: Text, plays: Count })),
  releases: v.array(v.object({ album: Text, date: Text })),
  streakDays: Count,
  streakStart: MaybeText,
  topTracks: v.array(v.object({ track: Text, plays: Count, cover: MaybeText })),
  topAlbums: v.array(v.object({ album: Text, plays: Count, cover: MaybeText })),
  albumColors: v.array(v.object({ album: Text, color: Text })),
  genres: Genres,
  firstTrack: v.nullable(v.object({ track: Text, at: Count })),
  collaborations: v.array(v.object({ artist: Text, plays: Count, tracks: v.array(v.object({ track: Text, plays: Count })) })),
  similar: v.array(v.object({ artist: Text, score: Count })),
})

const AlbumPage = v.object({
  ...EntityBase,
  kind: v.literal('album'),
  banner: MaybeText,
  artist: Text,
  releaseYear: MaybeCount,
  releaseKind: MaybeText,
  label: MaybeText,
  tracksHeard: Count,
  tracks: v.array(AlbumTrack),
})

const SongPage = v.object({
  ...EntityBase,
  kind: v.literal('song'),
  banner: MaybeText,
  artist: Text,
  album: MaybeText,
  releaseYear: MaybeCount,
  releaseKind: MaybeText,
  label: MaybeText,
  hours: v.array(Count),
  busiestDay: v.nullable(v.object({ day: Text, plays: Count })),
  genres: Genres,
  siblings: v.array(v.object({ track: Text, plays: Count })),
})

const CollectionPage = v.object({
  kind: v.literal('collection'),
  of: Kind,
  slug: Text,
  name: Text,
  artist: Text,
  releaseYear: MaybeCount,
  ownership: Ownership,
  genres: v.array(Text),
  styles: v.array(Text),
  label: MaybeText,
  catalogue: MaybeText,
  cover: MaybeText,
  tracks: v.array(AlbumTrack),
})

const Work = v.object({ ...LibraryWork.entries, kind: Kind })

const Concert = v.object({
  slug: Text,
  on: Text,
  at: MaybeText,
  title: Text,
  venue: MaybeText,
  venueSlug: MaybeText,
  upcoming: v.boolean(),
  albumId: MaybeText,
  photos: v.array(v.object({ url: Text, video: v.boolean() })),
  artist: MaybeText,
  acts: v.array(v.object({ name: Text, billing: v.nullable(v.picklist(['headliner', 'support'])) })),
  place: v.nullable(v.object({ lat: v.number(), lon: v.number(), map: Text })),
  setlists: v.array(v.object({ artist: Text, url: Text, songs: v.array(v.object({ name: Text, cover: MaybeText, encore: Count })) })),
})

export const RESPONSES = {
  periods: v.array(Text),
  history: v.object({ month: Text, months: v.array(Text), listens: v.array(Listen) }),
  weeks: v.object({ weeks: v.array(Week) }),
  months: v.object({ months: v.array(Span) }),
  years: v.object({ years: v.array(Span) }),
  entities: v.array(v.object({ kind: Kind, slug: Text, name: Text, artist: Text, cover: MaybeText, plays: Count })),
  library: v.object({ works: v.array(Work) }),
  entity: v.variant('kind', [ArtistPage, AlbumPage, SongPage, CollectionPage]),
  recent: v.array(v.object({ at: Count, track: Text, artist: Text, release: MaybeText, cover: MaybeText })),
  concerts: v.object({ concerts: v.array(Concert) }),
} satisfies {
  [File in keyof ApiResponses]: v.GenericSchema<unknown, ApiResponses[File]>
}
