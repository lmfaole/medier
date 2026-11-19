import type { ConcertSummary } from './types.ts'

export interface VenueSummary {
  slug: string
  name: string
  seen: number
  upcoming: number
  first: string | null
  last: string | null
}

/** The venues the concerts name, the most visited first, then by name: a concert with no venue is none's. */
export function venuesOf(concerts: readonly ConcertSummary[]): VenueSummary[] {
  const found = new Map<string, VenueSummary & { days: string[] }>()
  for (const concert of concerts) {
    if (concert.venue === null || concert.venueSlug === null) continue
    const venue = found.get(concert.venueSlug) ?? { slug: concert.venueSlug, name: concert.venue, seen: 0, upcoming: 0, first: null, last: null, days: [] }
    if (concert.upcoming) venue.upcoming += 1
    else {
      venue.seen += 1
      venue.days.push(concert.on)
    }
    found.set(concert.venueSlug, venue)
  }
  return [...found.values()]
    .map(({ days, ...venue }) => {
      const sorted = days.toSorted()
      return { ...venue, first: sorted[0] ?? null, last: sorted.at(-1) ?? null }
    })
    .toSorted((a, b) => b.seen - a.seen || a.name.localeCompare(b.name, 'nb'))
}
