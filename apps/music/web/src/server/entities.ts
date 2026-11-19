/**
 * The pages behind the sheets: the index of everything that has one, and one
 * page by kind and slug. `sync-rust/src/entities.rs` writes `entity_pages`
 * with a JSON `detail` per kind; each kind's shape is checked here before
 * anything reads it. Only reads, like the rest of the Worker's queries.
 */

import { queryRows } from '@designsystem/config/d1-query'
import { MusicCollectionRow } from '@designsystem/contracts/music-tables'
import type { LibraryWork } from '@designsystem/ui/lib/library'
import { normalizeTitle, slugOf } from '@designsystem/intl/text'
import { ownershipOf, type CollectionLine } from '@designsystem/ui/lib/ownership'
import * as v from 'valibot'

import type { AlbumPage, AlbumTrack, ArtistPage, CollectionPage, EntityKind, EntityPage, EntitySummary, SongPage } from '../lib/types.ts'
import { imageCreditOf, imagePathOf } from '@designsystem/config/artist-image'
import { releaseKindOf } from '../lib/release-kind.ts'
import { coverArtUrl } from './cover-art.ts'

const SQL = {
  index: 'SELECT kind, slug, name, artist_name, cover, play_count FROM entity_pages ORDER BY kind, play_count DESC, name',
  page: "SELECT page.kind, page.slug, page.name, page.artist_name, page.cover, page.play_count, page.detail, artist.image_mbid AS artist_image_mbid, artist.image_source AS artist_image_source FROM entity_pages AS page LEFT JOIN (SELECT name, json_extract(detail, '$.image_mbid') AS image_mbid, json_extract(detail, '$.image_source') AS image_source FROM entity_pages WHERE kind = 'artist') AS artist ON page.kind != 'artist' AND artist.name = page.artist_name WHERE page.kind = ? AND page.slug = ?",
  artistImages: "SELECT name, json_extract(detail, '$.image_mbid') AS image_mbid FROM entity_pages WHERE kind = 'artist' AND json_extract(detail, '$.image_mbid') IS NOT NULL",
  alias: 'SELECT slug FROM entity_alias WHERE kind = ? AND old_slug = ?',
  aliases: 'SELECT kind, old_slug FROM entity_alias ORDER BY kind, old_slug',
  collection: 'SELECT * FROM music_collection ORDER BY id',
  collectionTracks: 'SELECT disc, position, title, length_ms, artist_credit FROM album_track WHERE album_key = ? ORDER BY disc, position',
  colors: 'SELECT cover, color FROM music_cover_color WHERE cover IN (SELECT value FROM json_each(?))',
  discogs: "SELECT item.instance_id, item.label, item.catalogue_number, detail.genres, detail.styles, cover.release_mbid, cover.image_id FROM discogs_item AS item LEFT JOIN discogs_detail AS detail ON detail.release_id = item.release_id LEFT JOIN discogs_cover AS cover ON cover.release_id = item.release_id",
  library: "SELECT kind, slug, name, artist_name, cover, play_count, json_extract(detail, '$.first_at') AS first_at, json_extract(detail, '$.last_at') AS last_at FROM entity_pages ORDER BY play_count DESC, name",
}

const CollectionTrackRow = v.object({ disc: v.number(), position: v.number(), title: v.string(), length_ms: v.nullable(v.number()), artist_credit: v.nullable(v.string()) })

const KINDS = ['artist', 'album', 'song'] as const

// The table's own CHECK says `kind` is one of the three; the contract has it as text, so it is read as the kinds here.
const CollectionRow = v.object({ ...MusicCollectionRow.entries, kind: v.picklist(KINDS) })
type CollectionRow = v.InferOutput<typeof CollectionRow>

const DiscogsRow = v.object({ instance_id: v.number(), label: v.nullable(v.string()), catalogue_number: v.nullable(v.string()), genres: v.nullable(v.string()), styles: v.nullable(v.string()), release_mbid: v.nullable(v.string()), image_id: v.nullable(v.string()) })

const IndexRow = v.object({
  kind: v.picklist(KINDS),
  slug: v.string(),
  name: v.string(),
  artist_name: v.string(),
  cover: v.nullable(v.string()),
  play_count: v.number(),
})

const PageRow = v.object({ ...IndexRow.entries, detail: v.string(), artist_image_mbid: v.optional(v.nullable(v.string()), null), artist_image_source: v.optional(v.nullable(v.string()), null) })

const ArtistImageRow = v.object({ name: v.string(), image_mbid: v.string() })

const AliasRow = v.object({ slug: v.string() })
const AliasesRow = v.object({ kind: v.picklist(KINDS), old_slug: v.string() })

const LibraryRow = v.object({ ...IndexRow.entries, first_at: v.nullable(v.number()), last_at: v.nullable(v.number()) })

/** The picture of each artist that has one, by name: where an artist is shown, it is them and not an album of theirs. */
export async function artistImages(database: D1Database): Promise<Map<string, string>> {
  const images = new Map<string, string>()
  for (const row of await queryRows(database, SQL.artistImages, ArtistImageRow)) {
    const path = imagePathOf(row.image_mbid)
    if (path !== null) images.set(row.name, path)
  }
  return images
}

/** Unix seconds as `YYYY-MM-DD`, the day in UTC like the sync's days. */
const dayOf = (seconds: number | null): string | null => (seconds === null ? null : new Date(seconds * 1000).toISOString().slice(0, 10))

/** What a collection line and an entity page both are called by: the kind, who made it and its title, as letters and digits only, so «Janet.» and «Janet» and a curly apostrophe are the same. */
const keyOf = (kind: string, artist: string, title: string): string => `${kind}\u0000${normalizeTitle(artist)}\u0000${normalizeTitle(title)}`

/** The page address of a work of the collection that was never played, from the same key the library matches a line to a played work by. */
const collectionSlug = (line: Pick<CollectionRow, 'kind' | 'artist' | 'title'>): string => slugOf(`music\u0000${keyOf(line.kind, line.artist, line.title)}`)

const lineOf = (line: CollectionRow): CollectionLine => ({ status: line.status === 'owned' ? 'owned' : 'want', format: line.format, addedOn: line.added_on, rating: line.rating })

/** The collection's lines for no work that was played: one a work, the owned line first. */
function unplayedOf(lines: readonly CollectionRow[], played: ReadonlySet<string>): CollectionRow[] {
  const unmatched = new Map<string, CollectionRow>()
  for (const line of lines) {
    const key = keyOf(line.kind, line.artist, line.title)
    if (!played.has(key) && (!unmatched.has(key) || line.status === 'owned')) unmatched.set(key, line)
  }
  return [...unmatched.values()]
}

/**
 * Every artist, album and song as the library every app has: what it is, how often and between which days it was played,
 * and what the owner has or wants. A line of the collection that is also played is owned and heard; one that is not is
 * owned or wanted and has no page yet.
 */
export async function library(database: D1Database): Promise<{ works: LibraryWork<EntityKind>[] }> {
  const [rows, lines, discogs, images] = await Promise.all([queryRows(database, SQL.library, LibraryRow), queryRows(database, SQL.collection, CollectionRow), queryRows(database, SQL.discogs, DiscogsRow), artistImages(database)])
  const coverOfCopy = (note: string | null) => (note?.startsWith('discogs:') ? coverOf(discogs.filter((row) => row.instance_id === Number(note.slice('discogs:'.length)))) : null)
  const works = rows.map((row): LibraryWork<EntityKind> => ({ kind: row.kind, slug: row.slug, title: row.name, creator: row.artist_name === '' ? null : row.artist_name, year: null, cover: (row.kind === 'artist' ? images.get(row.name) : undefined) ?? coverArtUrl(row.cover), status: 'done', owned: false, rating: null, plays: row.play_count, firstOn: dayOf(row.first_at), lastOn: dayOf(row.last_at), genres: [] }))
  const played = new Map(works.map((work): [string, LibraryWork<EntityKind>] => [keyOf(work.kind, work.kind === 'artist' ? work.title : (work.creator ?? ''), work.kind === 'artist' ? '' : work.title), work]))
  for (const line of lines) {
    const known = played.get(keyOf(line.kind, line.artist, line.title))
    if (known !== undefined) {
      if (line.status === 'owned') {
        known.owned = true
        known.format ??= line.format
      }
      continue
    }
    const work: LibraryWork<EntityKind> = { kind: line.kind, slug: collectionSlug(line), title: line.kind === 'artist' ? line.artist : line.title, creator: line.kind === 'artist' ? null : line.artist, year: line.year, cover: coverOfCopy(line.note), status: line.status === 'owned' ? 'owned' : 'want', owned: line.status === 'owned', format: line.format, rating: line.rating, plays: 0, firstOn: null, lastOn: null, genres: [] }
    played.set(keyOf(line.kind, line.artist, line.title), work)
    works.push(work)
  }
  return { works }
}

/** Everything that has a sheet, by kind and then most played, so the page can look a name up and show its picture. */
export async function entities(database: D1Database): Promise<EntitySummary[]> {
  const [rows, images] = await Promise.all([queryRows(database, SQL.index, IndexRow), artistImages(database)])
  return rows.map((row) => ({
    kind: row.kind,
    slug: row.slug,
    name: row.name,
    artist: row.artist_name,
    cover: (row.kind === 'artist' ? images.get(row.name) : undefined) ?? coverArtUrl(row.cover),
    plays: row.play_count,
  }))
}

const Years = v.array(v.object({ year: v.number(), plays: v.number() }))
const Genres = v.array(v.object({ genre: v.string(), plays: v.number() }))
const Covered = v.nullable(v.string())

const Base = {
  minutes: v.number(),
  first_at: v.number(),
  last_at: v.number(),
  years: Years,
}

const ArtistDetail = v.object({
  ...Base,
  area: v.nullable(v.string()),
  begin_year: v.optional(v.nullable(v.number()), null),
  end_year: v.optional(v.nullable(v.number()), null),
  ended: v.optional(v.boolean(), false),
  image_mbid: v.optional(v.nullable(v.string()), null),
  image_source: v.optional(v.nullable(v.string()), null),
  album_years: v.optional(v.array(v.object({ album: v.nullable(v.string()), year: v.number(), plays: v.number() })), []),
  months: v.optional(v.array(v.object({ month: v.string(), plays: v.number() })), []),
  releases: v.optional(v.array(v.object({ album: v.string(), date: v.string() })), []),
  streak_days: v.number(),
  streak_start: v.nullable(v.string()),
  top_tracks: v.array(v.object({ track: v.string(), plays: v.number(), cover: Covered })),
  top_albums: v.array(v.object({ album: v.string(), plays: v.number(), cover: Covered })),
  genres: Genres,
  first_track: v.nullable(v.object({ track: v.string(), at: v.number() })),
  collaborations: v.optional(v.array(v.object({ artist: v.string(), plays: v.number(), tracks: v.array(v.object({ track: v.string(), plays: v.number() })) })), []),
  similar: v.optional(v.array(v.object({ artist: v.string(), score: v.number() })), []),
})

const AlbumTrack = v.object({
  track: v.string(),
  plays: v.number(),
  disc: v.optional(v.number()),
  position: v.optional(v.number()),
  credit: v.optional(v.string()),
  length_ms: v.optional(v.number()),
  first_at: v.optional(v.number()),
  last_at: v.optional(v.number()),
  release_year: v.optional(v.number()),
  loved: v.optional(v.boolean()),
  genres: v.optional(v.array(v.string())),
})

const ReleaseFields = {
  release_type: v.optional(v.nullable(v.string()), null),
  secondary_types: v.optional(v.nullable(v.string()), null),
  label: v.optional(v.nullable(v.string()), null),
  release_year: v.nullable(v.number()),
}

function factsOf(d: v.InferOutput<typeof AlbumDetail> | v.InferOutput<typeof SongDetail>) {
  return { minutes: d.minutes, firstAt: d.first_at, lastAt: d.last_at, years: d.years, releaseYear: d.release_year, releaseKind: releaseKindOf(d.release_type, d.secondary_types), label: d.label }
}

const AlbumDetail = v.object({
  ...Base,
  ...ReleaseFields,
  tracks_heard: v.number(),
  tracks: v.array(AlbumTrack),
})

const SongDetail = v.object({
  ...Base,
  ...ReleaseFields,
  album: v.nullable(v.string()),
  hours: v.pipe(v.array(v.number()), v.length(24)),
  busiest_day: v.nullable(v.object({ day: v.string(), plays: v.number() })),
  genres: Genres,
  siblings: v.array(v.object({ track: v.string(), plays: v.number() })),
})

/** The artist's picture as the app serves it, the address it is landed from and the Commons page that credits it; none unless all three are sound. */
function artistImageOf(mbid: string | null, source: string | null): Pick<ArtistPage, 'image' | 'imageSource' | 'imageCredit'> {
  const path = mbid === null ? null : imagePathOf(mbid)
  const credit = source === null ? null : imageCreditOf(source)
  return path === null || source === null || credit === null ? { image: null, imageSource: null, imageCredit: null } : { image: path, imageSource: source, imageCredit: credit }
}

const isKind = (kind: string | null): kind is EntityKind => KINDS.some((known) => known === kind)

/** The old addresses of pages whose spellings were joined, as the snapshot asks for them: each answers with the page it joined. */
export async function aliasedSheets(database: D1Database): Promise<{ kind: EntityKind; slug: string }[]> {
  return (await queryRows(database, SQL.aliases, AliasesRow)).map((row) => ({ kind: row.kind, slug: row.old_slug }))
}

/** The sheets of the collection's works that were never played, as the snapshot asks for them. */
export async function unplayedSheets(database: D1Database): Promise<{ kind: EntityKind; slug: string }[]> {
  return (await unplayed(database)).map((line) => ({ kind: v.parse(v.picklist(KINDS), line.kind), slug: collectionSlug(line) }))
}

/** The collection's lines of works with no sheet of plays, from the index of the sheets there are. */
async function unplayed(database: D1Database): Promise<CollectionRow[]> {
  const [index, lines] = await Promise.all([queryRows(database, SQL.index, IndexRow), queryRows(database, SQL.collection, CollectionRow)])
  return unplayedOf(lines, new Set(index.map((row) => keyOf(row.kind, row.kind === 'artist' ? row.name : row.artist_name, row.kind === 'artist' ? '' : row.name))))
}

const ColorRow = v.object({ cover: v.string(), color: v.string() })

/** The colour of each of the covers (`<release>/<image>`) that has one, from `npm run cover:colors`. */
async function coverColors(database: D1Database, covers: readonly (string | null)[]): Promise<Map<string, string>> {
  const named = covers.filter((cover): cover is string => cover !== null)
  if (named.length === 0) return new Map()
  const rows = await queryRows(database, SQL.colors, ColorRow, JSON.stringify([...new Set(named)]))
  return new Map(rows.map((row) => [row.cover, row.color]))
}

/** The cover of the first copy that has one, as the page serves it. */
function coverOf(rows: readonly v.InferOutput<typeof DiscogsRow>[]): string | null {
  const row = rows.find((candidate) => candidate.release_mbid !== null && candidate.image_id !== null)
  return row === undefined ? null : coverArtUrl(`${row.release_mbid}/${row.image_id}`)
}

/** What Discogs says of the copies of a work (the lines it added are marked `discogs:<copy>` in the note): genres, styles, label and catalogue number, each once. */
async function discogsFacts(database: D1Database, lines: readonly CollectionRow[]): Promise<{ genres: string[]; styles: string[]; label: string | null; catalogue: string | null; cover: string | null }> {
  const copies = new Set(lines.flatMap((line) => (line.note?.startsWith('discogs:') ? [Number(line.note.slice('discogs:'.length))] : [])))
  const rows = (await queryRows(database, SQL.discogs, DiscogsRow)).filter((row) => copies.has(row.instance_id))
  const split = (text: string | null) => (text === null ? [] : text.split('|'))
  return { genres: [...new Set(rows.flatMap((row) => split(row.genres)))], styles: [...new Set(rows.flatMap((row) => split(row.styles)))], label: rows.find((row) => row.label !== null)?.label ?? null, catalogue: rows.find((row) => row.catalogue_number !== null)?.catalogue_number ?? null, cover: coverOf(rows) }
}

/** The tracks of an album of the collection, as `music-sync album-tracklists` keeps them under the artist and title the collection spells; empty when no line of it has a tracklist. */
async function collectionTracks(database: D1Database, lines: readonly CollectionRow[]): Promise<AlbumTrack[]> {
  for (const line of lines) {
    const rows = await queryRows(database, SQL.collectionTracks, CollectionTrackRow, `collection:${line.artist}\u0000${line.title}`)
    if (rows.length > 0) return rows.map((row) => ({ track: row.title, plays: 0, disc: row.disc, position: row.position, credit: row.artist_credit !== null && row.artist_credit !== line.artist ? row.artist_credit : undefined, lengthMs: row.length_ms ?? undefined, loved: false, genres: [] }))
  }
  return []
}

/** The page of a work the owner has or wants and has never played, or none for a slug no such work has. */
async function unplayedPage(database: D1Database, kind: EntityKind, slug: string): Promise<CollectionPage | null> {
  const line = (await unplayed(database)).find((candidate) => candidate.kind === kind && collectionSlug(candidate) === slug)
  if (line === undefined) return null
  const own = (await queryRows(database, SQL.collection, CollectionRow)).filter((other) => keyOf(other.kind, other.artist, other.title) === keyOf(line.kind, line.artist, line.title))
  const ownership = ownershipOf(own.map(lineOf))
  if (ownership === null) return null
  return { kind: 'collection', of: kind, slug, name: kind === 'artist' ? line.artist : line.title, artist: kind === 'artist' ? '' : line.artist, releaseYear: line.year, ownership, ...(await discogsFacts(database, own)), tracks: kind === 'album' ? await collectionTracks(database, own) : [] }
}

/** One sheet's page. `null` for a kind that does not exist or a slug with no page, so the Worker answers 404. */
export async function entity(database: D1Database, kind: string | null, slug: string | null): Promise<EntityPage | null> {
  if (!isKind(kind) || slug === null) return null
  const [row] = await queryRows(database, SQL.page, PageRow, kind, slug)
  if (!row) {
    // An old address of a page whose spellings were joined answers with that page; the route sends the reader to its own.
    const [joined] = await queryRows(database, SQL.alias, AliasRow, kind, slug)
    return joined === undefined ? unplayedPage(database, kind, slug) : entity(database, kind, joined.slug)
  }
  const detail: unknown = JSON.parse(row.detail)
  const key = keyOf(row.kind, row.kind === 'artist' ? row.name : row.artist_name, row.kind === 'artist' ? '' : row.name)
  const lines = (await queryRows(database, SQL.collection, CollectionRow)).filter((line) => keyOf(line.kind, line.artist, line.title) === key)
  const ownership = ownershipOf(lines.map(lineOf))
  const base = { slug: row.slug, name: row.name, cover: coverArtUrl(row.cover), plays: row.play_count, ownership }
  const colorOfCover = async (...covers: (string | null)[]) => (await coverColors(database, covers))
  // The wide picture behind an album's or a song's head is a photo of its artist, where there is one.
  const banner = row.kind === 'artist' ? null : artistImageOf(row.artist_image_mbid, row.artist_image_source).image

  switch (row.kind) {
    case 'artist': {
      const d = v.parse(ArtistDetail, detail)
      const colors = await colorOfCover(...d.top_albums.map((top) => top.cover))
      const page: ArtistPage = {
        ...base,
        accent: colors.get(d.top_albums[0]?.cover ?? '') ?? null,
        albumColors: d.top_albums.flatMap((top) => (colors.has(top.cover ?? '') ? [{ album: top.album, color: colors.get(top.cover ?? '') ?? '' }] : [])),
        kind: 'artist',
        minutes: d.minutes,
        firstAt: d.first_at,
        lastAt: d.last_at,
        years: d.years,
        area: d.area,
        beginYear: d.begin_year,
        endYear: d.end_year,
        ended: d.ended,
        ...artistImageOf(d.image_mbid, d.image_source),
        albumYears: d.album_years,
        months: d.months,
        releases: d.releases,
        streakDays: d.streak_days,
        streakStart: d.streak_start,
        topTracks: d.top_tracks.map((top) => ({ track: top.track, plays: top.plays, cover: coverArtUrl(top.cover) })),
        topAlbums: d.top_albums.map((top) => ({ album: top.album, plays: top.plays, cover: coverArtUrl(top.cover) })),
        genres: d.genres,
        firstTrack: d.first_track,
        collaborations: d.collaborations,
        similar: d.similar,
      }
      return page
    }
    case 'album': {
      const d = v.parse(AlbumDetail, detail)
      const page: AlbumPage = {
        ...base,
        accent: (await colorOfCover(row.cover)).get(row.cover ?? '') ?? null,
        kind: 'album',
        banner,
        artist: row.artist_name,
        ...factsOf(d),
        tracksHeard: d.tracks_heard,
        tracks: d.tracks.map((track) => ({ track: track.track, plays: track.plays, disc: track.disc, position: track.position, credit: track.credit, lengthMs: track.length_ms, firstAt: track.first_at, lastAt: track.last_at, releaseYear: track.release_year, loved: track.loved === true, genres: track.genres ?? [] })),
      }
      return page
    }
    case 'song': {
      const d = v.parse(SongDetail, detail)
      const page: SongPage = {
        ...base,
        accent: (await colorOfCover(row.cover)).get(row.cover ?? '') ?? null,
        kind: 'song',
        banner,
        artist: row.artist_name,
        ...factsOf(d),
        album: d.album,
        hours: d.hours,
        busiestDay: d.busiest_day,
        genres: d.genres,
        siblings: d.siblings,
      }
      return page
    }
  }
}
