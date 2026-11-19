// What every app's library holds, the same for a film, a game, an album and a podcast: one entry per work, with how the
// owner stands to it. An app builds its own entries (`library.json`); the library page is one, so what is shown and how
// is the same everywhere.

/** How the owner stands to a work, furthest along first: it is under way, finished, owned, wanted, or given up on. */
export const LIBRARY_STATUSES = ['doing', 'done', 'owned', 'want', 'dropped'] as const

export type LibraryStatus = (typeof LIBRARY_STATUSES)[number]

/** The words for the statuses unless an app has better ones (a game is «Spilt ut», a book «Lest»). */
export const DEFAULT_STATUS_LABELS: Readonly<Record<LibraryStatus, string>> = { doing: 'Pågår', done: 'Ferdig', owned: 'Eier', want: 'Ønsker', dropped: 'Droppet' }

/**
 * One work of a library. `Kind` is the kinds the app's library has (`'artist' | 'album' | 'song'`), so that what labels and links
 * them is checked against it; an app with one kind leaves it a string. `plays` is how often it was seen, heard or played, and is 0 for one that is only owned or wanted. */
export interface LibraryWork<Kind extends string = string> {
  /** What it is, in the app's own terms: `film`, `serie`, `game`, `album`, `show`. The page of the work is of this kind. */
  kind: Kind
  /** The page of the work, or none where the work is owned or wanted and has not been seen, heard or played yet. */
  slug: string | null
  title: string
  /** Who made it: a director, a developer, an author, an artist. */
  creator: string | null
  year: number | null
  cover: string | null
  status: LibraryStatus
  /** Whether the owner has it, whatever else it is: a film seen and owned is `done` and owned. */
  owned: boolean
  /** What the owner has of it (`cd`, `vinyl`, `digital`), where the collection says; the work page tells the same. */
  format?: string | null
  rating: number | null
  plays: number
  /** The first and the last day it was seen, heard or played, where the log gives them. */
  firstOn: string | null
  lastOn: string | null
  genres: string[]
}

/** The most recently seen first, the works with no day last, and the title where the day is the same. */
export function newestFirst(a: LibraryWork, b: LibraryWork): number {
  return (a.lastOn === null ? 1 : 0) - (b.lastOn === null ? 1 : 0) || (b.lastOn ?? '').localeCompare(a.lastOn ?? '') || a.title.localeCompare(b.title, 'nb')
}
