import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import type { ConcertSummary } from './types.ts'
import { venuesOf } from './venues.ts'

const concert = (on: string, venue: string | null, upcoming = false): ConcertSummary => ({ slug: on, on, at: null, title: 'T', venue, venueSlug: venue?.toLowerCase() ?? null, upcoming, albumId: null, photos: [], artist: null, acts: [], place: null, setlists: [] })

test('venues are counted by concerts seen, upcoming ones apart, and a concert with no venue is nobody\'s', () => {
  const venues = venuesOf([concert('2026-01-01', 'Sentrum'), concert('2026-03-01', 'Rockefeller'), concert('2026-02-01', 'Rockefeller'), concert('2027-01-01', 'Sentrum', true), concert('2026-04-01', null)])
  assert.deepEqual(venues.map((venue) => [venue.name, venue.seen, venue.upcoming, venue.first, venue.last]), [
    ['Rockefeller', 2, 0, '2026-02-01', '2026-03-01'],
    ['Sentrum', 1, 1, '2026-01-01', '2026-01-01'],
  ])
})
