/**
 * Which of the releases Last.fm ranks for an artist are albums. Last.fm's `artist.gettopalbums` lists every release that has plays (singles, EPs, live albums, compilations,
 * remixes, soundtracks) and an album once for each edition of it («Album», «Album (Deluxe Edition)»). Where MusicBrainz said which are albums (`musicbrainz.ts`), only those are
 * kept; where it could not, the titles that say they are something else are left out. Each album is shown once, with the plays of all its editions.
 */

import type { ArtistAlbum } from "./lastfm.ts"
import type { StudioAlbum } from "./musicbrainz.ts"
import { plain } from "./spotify.ts"

/** What an edition is called, in brackets or after a dash at the end of a title: «(Deluxe Edition)», «[2011 Remaster]», « - Expanded». */
const EDITION = /\b(deluxe|remaster(ed)?|expanded|edition|anniversary|bonus|version|reissue|special|collector'?s|super|explicit|clean|mono|stereo)\b/i
/** A release that says it is a single or an EP: « - Single», «(EP)», «[EP]», «Name EP». */
const SINGLE_OR_EP = [/(\s[-–]\s*|[([]\s*)(single|ep)\s*[)\]]?\s*$/i, /\sEP$/]
/** Titles that say a release is a live album, a compilation, remixes, a soundtrack, demos or a DJ mix. */
const NOT_AN_ALBUM = [
  /[([]\s*live\b|\blive (at|from|in|on)\b|\s[-–]\s*live$|\bunplugged\b/i,
  /\b(greatest hits|best of|the very best|anthology|b-sides|rarities)\b|^(the )?essential\b/i,
  /\bremix(es|ed)?\b/i,
  /\b(soundtrack|original score|motion picture|ost)\b/i,
  /\bdemos?\b/i,
  /\b(dj[- ]?mix|dj-kicks|mixed by|continuous mix)\b/i,
]

/** What an album is known by whatever the edition: its title with no edition at the end, nor « - Single», as `plain` compares it. */
export function albumKey(title: string): string {
  let rest = title.trim()
  for (;;) {
    const bracket = /\s*[([]([^()[\]]*)[)\]]\s*$/.exec(rest)
    const dash = /\s+[-–]\s+([^-–]*)$/.exec(rest)
    const end = bracket !== null && EDITION.test(bracket[1] ?? "") ? bracket : dash !== null && (EDITION.test(dash[1] ?? "") || /^(single|ep)$/i.test((dash[1] ?? "").trim())) ? dash : null
    if (end === null || end.index === 0) break
    rest = rest.slice(0, end.index)
  }
  return plain(rest)
}

/** Whether a title says a release is a single or an EP. */
export const isSingleOrEp = (title: string): boolean => SINGLE_OR_EP.some((pattern) => pattern.test(title.trim()))

/** Whether a title could be an album's: it does not say it is a single, an EP, live, a compilation, remixes, a soundtrack, demos or a DJ mix. A guess, for when MusicBrainz cannot say. */
export const looksLikeAlbum = (title: string): boolean => !isSingleOrEp(title) && !NOT_AN_ALBUM.some((pattern) => pattern.test(title))

/**
 * The artist's albums among those Last.fm ranks, most played first, at most `limit`. With `studio` (MusicBrainz's albums), only the releases that are one of them; without it
 * (`null`: MusicBrainz did not answer or does not know the artist), only those whose title does not say they are something else. The editions of an album are one row: the
 * plays of them all, and the name, address and cover of the most played one (the cover of another where it has none).
 */
export function realAlbums(lastfm: readonly ArtistAlbum[], studio: readonly StudioAlbum[] | null, limit = 8): ArtistAlbum[] {
  const allowed = studio === null ? null : new Set(studio.map((album) => albumKey(album.title)))
  const editions = new Map<string, ArtistAlbum[]>()
  for (const album of lastfm) {
    const key = albumKey(album.title)
    if (key === "" || isSingleOrEp(album.title) || (allowed === null ? !looksLikeAlbum(album.title) : !allowed.has(key))) continue
    editions.set(key, [...(editions.get(key) ?? []), album])
  }
  return [...editions.values()]
    .map((all) => {
      const first = all.reduce((best, album) => (album.plays > best.plays ? album : best))
      return { ...first, plays: all.reduce((sum, album) => sum + album.plays, 0), image: first.image ?? all.find((album) => album.image !== null)?.image ?? null }
    })
    .sort((a, b) => b.plays - a.plays)
    .slice(0, limit)
}
