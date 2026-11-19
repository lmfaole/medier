/**
 * The schema of each API file a watch-log app's pages read (`readApi`), next to the shapes `WatchResponses` names: an app's
 * `RESPONSES` spreads `WATCH_RESPONSES` and adds the files of its own. Imports no SQL, so a page can take it at run time.
 * A shape that changes in `viewing.ts` fails the typecheck here until its schema follows.
 */

import { LIBRARY_STATUSES } from '@designsystem/ui/lib/library'
import { Text, MaybeText, Count, MaybeCount } from '@designsystem/ui/lib/schema-parts'
import * as v from 'valibot'

import type { WatchResponses } from './responses.ts'

const Episode = v.nullable(v.object({ season: MaybeCount, episode: MaybeCount }))
const Totals = v.object({ plays: Count, works: Count, minutes: Count, rated: Count, averageRating: MaybeCount, firstOn: MaybeText, lastOn: MaybeText })
const Listing = v.object({ key: Text, slug: Text, title: Text, year: MaybeCount, rating: MaybeCount, plays: Count, cover: MaybeText })
const Group = v.object({ name: Text, slug: MaybeText, kind: v.nullable(v.picklist(['person', 'place'])), works: Count })
const Fact = v.tuple([Text, MaybeText])
const Linked = v.object({ name: Text, slug: Text })

const Overview = v.object({
  totals: Totals,
  years: v.array(v.object({ year: Count, plays: Count })),
  best: v.array(Listing),
  lead: v.array(Group),
  recent: v.array(v.object({ slug: Text, title: Text, year: MaybeCount, on: Text, rating: MaybeCount, at: MaybeText, cinema: MaybeText, poster: MaybeText, episode: Episode })),
  planned: v.array(v.object({ on: Text, at: MaybeText, title: Text, cinema: MaybeText })),
  months: v.array(v.object({ month: Text, plays: Count })),
  weekdays: v.array(Count),
  actors: v.array(Group),
  genres: v.array(Group),
  countries: v.array(Group),
  languages: v.array(Group),
  decades: v.array(Group),
  places: v.array(Group),
})

const History = v.object({
  year: Text,
  years: v.array(Text),
  plays: v.array(v.object({ on: Text, slug: Text, title: Text, year: MaybeCount, rating: MaybeCount, rewatch: v.boolean(), episode: Episode, place: MaybeText, cover: MaybeText, creator: MaybeText })),
})

/** One work of a library, which an app with its own kinds (podkast's shows and episodes) narrows `kind` of. */
export const LibraryWork = v.object({
  kind: Text,
  slug: MaybeText,
  title: Text,
  creator: MaybeText,
  year: MaybeCount,
  cover: MaybeText,
  status: v.picklist(LIBRARY_STATUSES),
  owned: v.boolean(),
  format: v.optional(MaybeText),
  rating: MaybeCount,
  plays: Count,
  firstOn: MaybeText,
  lastOn: MaybeText,
  genres: v.array(Text),
})

const Library = v.object({ works: v.array(LibraryWork) })

const Ownership = v.object({
  status: v.picklist(['owned', 'want']),
  format: MaybeText,
  lines: v.array(v.object({ status: v.picklist(['owned', 'want']), format: MaybeText, addedOn: MaybeText, rating: MaybeCount })),
})

/** A franchise with every part, as a card on a film's page. */
export const FranchiseShelf = v.object({
  name: Text,
  backdrop: MaybeText,
  seen: Count,
  total: Count,
  parts: v.array(v.object({ title: Text, year: MaybeCount, slug: MaybeText, cover: MaybeText, seen: v.boolean(), current: v.boolean() })),
})

const ItemPage = v.object({
  kind: v.literal('item'),
  slug: Text,
  title: Text,
  year: MaybeCount,
  originalTitle: MaybeText,
  overview: MaybeText,
  tagline: MaybeText,
  cover: MaybeText,
  backdrop: MaybeText,
  facts: v.array(Fact),
  links: v.array(Fact),
  lead: v.array(Linked),
  cast: v.array(v.object({ name: Text, slug: Text, character: MaybeText })),
  crew: v.array(v.object({ job: Text, people: v.array(Linked) })),
  seen: v.array(v.object({ on: MaybeText, rating: MaybeCount, rewatch: v.boolean(), place: v.nullable(Linked), seat: MaybeText, episode: Episode })),
  keywords: v.array(Text),
  ownership: v.nullable(Ownership),
  related: v.array(v.object({ title: Text, year: MaybeCount, slug: MaybeText, seen: v.boolean() })),
  franchise: v.nullable(FranchiseShelf),
})

const PersonPage = v.object({
  kind: v.literal('person'),
  slug: Text,
  name: Text,
  lead: v.array(Listing),
  acted: v.array(Listing),
  crewed: v.array(v.object({ job: Text, works: v.array(Listing) })),
  tmdbId: Count,
  born: MaybeText,
  died: MaybeText,
  placeOfBirth: MaybeText,
  department: MaybeText,
  biography: MaybeText,
  biographyLanguage: MaybeText,
  imdbId: MaybeText,
})

const PlacePage = v.object({
  kind: v.literal('place'),
  slug: Text,
  name: Text,
  owner: MaybeText,
  city: MaybeText,
  country: MaybeText,
  website: MaybeText,
  image: MaybeText,
  visits: Count,
  first: MaybeText,
  last: MaybeText,
  works: v.array(Listing),
  halls: v.array(v.object({ name: MaybeText, visits: Count, works: v.array(Listing) })),
})

export const WATCH_RESPONSES = {
  overview: Overview,
  history: History,
  library: Library,
  entity: v.nullable(v.variant('kind', [ItemPage, PersonPage, PlacePage])),
} satisfies { [File in keyof WatchResponses]: v.GenericSchema<unknown, WatchResponses[File]> }
