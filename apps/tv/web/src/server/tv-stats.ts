/**
 * The TV's own half of the watch API: the config the shared counting speaks (`TV`) and the page of one series. The
 * words of the pages, the shape of the register's answer about a series (`TvInfo`) and the register's own facts of one
 * series are `../words.ts`.
 */

import { creditsOf, itemKey, backdropUrl, posterUrl, watchCore, type ItemLink, type ItemPage, type WatchConfig, type WatchPlace, type WatchViewing } from '@designsystem/watch/viewing'

import { seriesFacts, seriesLinks, words, type TvInfo } from '../words.ts'

/** The crew jobs a series page shows besides its creators, in the order it shows them. */
export const CREW_JOBS = ['Writer', 'Cinematography', 'Composer', 'Editor', 'Producer'] as const
export type CrewJob = (typeof CREW_JOBS)[number]

/** A network as the register has it: a viewing's place is the network its series is shown on. */
export type Network = WatchPlace

/** One line of the tv log, an episode, with the series and the network TMDB matched it to. */
export type Viewing = WatchViewing<TvInfo>

/** The TV's words for the shared counting, and every count bound to them. */
export const TV: WatchConfig<'serie', 'network'> = {
  noun: words.noun,
  itemKind: words.itemKind,
  placeKind: words.placeKind,
  leadJob: 'Creator',
  crewJobs: CREW_JOBS,
}

const core = watchCore(TV)

const peopleOf = (credits: ReturnType<typeof creditsOf>): ItemLink[] => credits.map((credit) => ({ name: credit.name, slug: core.personSlug(credit) }))

/** The page of one series, or `null` for a key no viewing has. */
export function seriesPageOf(viewings: readonly Viewing[], key: string): ItemPage | null {
  const own = viewings.filter((viewing) => itemKey(viewing) === key)
  const latest = own.at(-1)
  if (latest === undefined) return null
  const series = latest.item
  return {
    kind: 'item',
    slug: core.itemSlug(key),
    title: series?.title ?? latest.title,
    year: series?.year ?? latest.year,
    originalTitle: series?.originalTitle != null && series.originalTitle !== series.title ? series.originalTitle : null,
    overview: series?.overview ?? null,
    tagline: series?.tagline ?? null,
    cover: posterUrl(series),
    backdrop: backdropUrl(series),
    facts: seriesFacts(series),
    links: seriesLinks(series),
    lead: peopleOf(creditsOf(series, 'Creator')),
    cast: creditsOf(series, 'Cast').map((credit) => ({ name: credit.name, slug: core.personSlug(credit), character: credit.character })),
    crew: CREW_JOBS.map((job) => ({ job, people: peopleOf(creditsOf(series, job)) })).filter((group) => group.people.length > 0),
    seen: core.seenOf(own),
    keywords: series?.keywords ?? [],
    ownership: null,
    related: [],
    franchise: null,
  }
}
