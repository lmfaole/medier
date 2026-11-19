// What an album page says of a track in its popover, from what is known of it, and the length of the whole album.

import { formatHoursAndMinutes, formatTimestampDay } from '@designsystem/intl/listening'
import type { AlbumTrack } from './types.ts'

/** 201000 → «3:21». */
export function formatTrackLength(lengthMs: number): string {
  const seconds = Math.round(lengthMs / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** The length of the tracks that have one, as «42 min», or null when none has; `complete` is false when some track's length is not known. */
export function albumLength(tracks: readonly AlbumTrack[]): { text: string; complete: boolean } | null {
  const known = tracks.flatMap((track) => (track.lengthMs === undefined ? [] : [track.lengthMs]))
  if (known.length === 0) return null
  return { text: formatHoursAndMinutes(Math.round(known.reduce((sum, ms) => sum + ms, 0) / 60_000)), complete: known.length === tracks.length }
}

/** «3», or «2-3» on a later disc of an album with several; none for a track that is not on the tracklist. */
export function trackNumber(track: AlbumTrack, hasDiscs: boolean): string | null {
  if (track.position === undefined) return null
  return hasDiscs ? `${track.disc ?? 1}-${track.position}` : String(track.position)
}

/** What the popover of a track lists, as label and value in reading order; a fact nothing knows is left out. */
export function trackInfo(track: AlbumTrack, hasDiscs: boolean): (readonly [string, string])[] {
  const facts: [string, string | null][] = [
    ['Nummer', trackNumber(track, hasDiscs)],
    ['Lengde', track.lengthMs === undefined ? null : formatTrackLength(track.lengthMs)],
    ['Kreditt', track.credit ?? null],
    ['Sjangre', track.genres.length === 0 ? null : track.genres.join(', ')],
    ['Utgitt', track.releaseYear === undefined ? null : String(track.releaseYear)],
    ['Første gang spilt', track.firstAt === undefined ? null : formatTimestampDay(track.firstAt)],
    ['Sist spilt', track.lastAt === undefined ? null : formatTimestampDay(track.lastAt)],
    ['Elsket', track.loved ? 'Ja' : null],
  ]
  return facts.flatMap(([label, value]) => (value === null ? [] : [[label, value] as const]))
}
