/**
 * The schema of each API file a podkast page reads (`readApi`), next to the server's loaders: `RESPONSES` must produce what
 * `API` returns, so a loader that changes its answer fails the typecheck here until its schema follows. No SQL is
 * imported, so a page can take this at run time.
 */
import { Text, MaybeText, Count, MaybeCount } from '@designsystem/ui/lib/schema-parts'
import * as v from 'valibot'

import type { ApiResponses } from './api.ts'

const Totals = v.object({ plays: Count, minutes: Count, shows: Count, episodes: Count, firstAt: MaybeCount, lastAt: MaybeCount })
const Years = v.array(v.object({ year: Count, plays: Count }))
const TopShow = v.object({ name: Text, plays: Count, episodes: Count, minutes: Count })
const Kind = v.picklist(['show', 'episode'])

const Overview = v.object({
  totals: Totals,
  years: Years,
  months: v.array(v.object({ month: Text, plays: Count })),
  weekdays: v.array(Count),
  hours: v.array(Count),
  topShows: v.array(v.object({ ...TopShow.entries, slug: Text, cover: MaybeText })),
  recent: v.array(v.object({ at: Count, show: Text, episode: Text, cover: MaybeText })),
})

const Entity = v.object({ kind: Kind, slug: Text, name: Text, show: MaybeText, cover: MaybeText })


const Person = v.object({ name: Text, role: Text, href: MaybeText })

const ShowPage = v.object({
  kind: v.literal('show'),
  slug: Text,
  name: Text,
  totals: Totals,
  years: Years,
  topEpisodes: v.array(v.object({ name: Text, slug: Text, plays: Count })),
  cover: MaybeText,
  about: v.nullable(
    v.object({
      title: Text,
      author: MaybeText,
      owner: MaybeText,
      language: MaybeText,
      country: MaybeText,
      genre: MaybeText,
      description: MaybeText,
      website: MaybeText,
      appleUrl: MaybeText,
      feedUrl: MaybeText,
      people: v.array(Person),
    }),
  ),
})

const EpisodePage = v.object({
  kind: v.literal('episode'),
  slug: Text,
  name: Text,
  show: v.object({ name: Text, slug: Text }),
  totals: Totals,
  listens: v.array(Count),
  cover: MaybeText,
  about: v.nullable(
    v.object({ description: MaybeText, publishedAt: MaybeCount, durationSeconds: MaybeCount, link: MaybeText, season: MaybeCount, episode: MaybeCount, people: v.array(Person) }),
  ),
})

const History = v.object({ month: Text, months: v.array(Text), plays: v.array(v.object({ at: Count, show: Text, episode: Text, ms: Count, cover: MaybeText })) })

export const RESPONSES = {
  overview: Overview,
  entities: v.array(Entity),
  entity: v.nullable(v.variant('kind', [ShowPage, EpisodePage])),
  history: History,
  covers: v.array(v.object({ cover: Text, coverSource: Text })),
} satisfies {
  [File in keyof ApiResponses]: v.GenericSchema<unknown, ApiResponses[File]>
}
