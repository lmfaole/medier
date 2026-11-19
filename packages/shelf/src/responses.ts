/**
 * The schema of each API file a shelf app serves (`readApi`), written once for games, books and board games: their answers
 * have one shape. `satisfies` ties every schema to the type the loader returns (`ShelfResponses`), so a loader that changes
 * its answer fails the typecheck here until its schema follows. No SQL is imported, so a page can take this at run time.
 */

import { LIBRARY_STATUSES } from '@designsystem/ui/lib/library'
import type { LibraryWork } from '@designsystem/ui/lib/library'
import * as v from 'valibot'

import type { ShelfResponses } from './api.ts'
import type { Achievement, Facets, Group, HistoryEntry, Listing, LogEntry, Overview, Reading, ToBeat, WorkPage } from './shelf.ts'

const Nullable = {
  string: v.nullable(v.string()),
  number: v.nullable(v.number()),
}

const GroupSchema: v.GenericSchema<unknown, Group> = v.object({ name: v.string(), works: v.number() })

const ListingSchema: v.GenericSchema<unknown, Listing> = v.object({
  slug: v.string(),
  title: v.string(),
  year: Nullable.number,
  creator: Nullable.string,
  cover: Nullable.string,
  status: v.string(),
  rating: Nullable.number,
  amount: Nullable.number,
  on: Nullable.string,
})

const HistoryEntrySchema: v.GenericSchema<unknown, HistoryEntry> = ListingSchema

const ReadingSchema: v.GenericSchema<unknown, Reading> = v.object({
  service: v.string(),
  key: v.string(),
  label: v.string(),
  value: v.number(),
  max: Nullable.number,
  history: v.array(v.object({ day: v.string(), value: v.number() })),
})

const OverviewSchema: v.GenericSchema<unknown, Overview> = v.object({
  totals: v.object({ works: v.number(), done: v.number(), rated: v.number(), averageRating: Nullable.number, amount: v.number(), firstOn: Nullable.string }),
  achievements: v.object({ total: v.number(), unlocked: v.number(), completed: v.number() }),
  statuses: v.array(v.object({ status: v.string(), works: v.number() })),
  years: v.array(v.object({ year: v.number(), works: v.number() })),
  best: v.array(ListingSchema),
  creators: v.array(GroupSchema),
  genres: v.array(GroupSchema),
  decades: v.array(GroupSchema),
  platforms: v.array(GroupSchema),
  themes: v.array(GroupSchema),
  profiles: v.array(ReadingSchema),
  authorCountries: v.array(GroupSchema),
  recent: v.array(ListingSchema),
})

const LibraryWorkSchema: v.GenericSchema<unknown, LibraryWork> = v.object({
  kind: v.string(),
  slug: Nullable.string,
  title: v.string(),
  creator: Nullable.string,
  year: Nullable.number,
  cover: Nullable.string,
  status: v.picklist(LIBRARY_STATUSES),
  owned: v.boolean(),
  format: v.optional(Nullable.string),
  rating: Nullable.number,
  plays: v.number(),
  firstOn: Nullable.string,
  lastOn: Nullable.string,
  genres: v.array(v.string()),
})

const AchievementSchema: v.GenericSchema<unknown, Achievement> = v.object({
  service: v.string(),
  title: v.string(),
  description: Nullable.string,
  icon: Nullable.string,
  iconSource: Nullable.string,
  points: Nullable.number,
  rarity: Nullable.number,
  unlockedAt: Nullable.number,
  progress: Nullable.number,
  target: Nullable.number,
  tier: Nullable.number,
  tiers: Nullable.number,
})

const LogEntrySchema: v.GenericSchema<unknown, LogEntry> = v.object({ on: Nullable.string, status: v.string(), rating: Nullable.number, amount: Nullable.number, format: Nullable.string })

const FacetsSchema: v.GenericSchema<unknown, Facets> = v.object({
  platform: v.array(v.string()),
  mode: v.array(v.string()),
  theme: v.array(v.string()),
  perspective: v.array(v.string()),
  series: v.array(v.string()),
})

const ToBeatSchema: v.GenericSchema<unknown, ToBeat> = v.object({ hastily: Nullable.number, normally: Nullable.number, completely: Nullable.number })

const WorkPageSchema: v.GenericSchema<unknown, WorkPage> = v.object({
  title: v.string(),
  year: Nullable.number,
  creator: Nullable.string,
  summary: Nullable.string,
  cover: Nullable.string,
  coverSource: Nullable.string,
  banner: Nullable.string,
  bannerSource: Nullable.string,
  url: Nullable.string,
  genres: v.array(v.string()),
  status: v.string(),
  rating: Nullable.number,
  owned: v.boolean(),
  format: Nullable.string,
  collection: v.nullable(
    v.object({
      status: v.picklist(['owned', 'want']),
      format: Nullable.string,
      lines: v.array(v.object({ status: v.picklist(['owned', 'want']), format: Nullable.string, addedOn: Nullable.string, rating: Nullable.number })),
    }),
  ),
  entries: v.array(LogEntrySchema),
  achievements: v.array(AchievementSchema),
  rommId: Nullable.number,
  logos: v.record(v.string(), v.string()),
  facets: FacetsSchema,
  toBeat: v.nullable(ToBeatSchema),
  pages: Nullable.number,
  authorCountry: Nullable.string,
  profile: v.array(ReadingSchema),
})

export const SHELF_RESPONSES = {
  overview: OverviewSchema,
  library: v.object({ works: v.array(LibraryWorkSchema) }),
  history: v.object({ year: v.string(), years: v.array(v.string()), entries: v.array(HistoryEntrySchema) }),
  companies: v.array(v.object({ logo: v.string(), logoSource: v.string() })),
  entity: v.nullable(WorkPageSchema),
} satisfies { [File in keyof ShelfResponses]: v.GenericSchema<unknown, ShelfResponses[File]> }
