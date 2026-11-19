/**
 * The film's own half of the watch API: the config the shared counting speaks (`FILM`) and the page of one film. The
 * words of the pages, the shape of the register's answer about a film (`FilmInfo`) and the register's own facts of one
 * film are `../words.ts`.
 */

import { creditsOf, itemKey, backdropUrl, posterUrl, watchCore, type ItemLink, type ItemPage, type WatchConfig, type WatchPlace, type WatchViewing } from '@designsystem/watch/viewing'

import { filmFacts, filmLinks, words, type FilmInfo } from '../words.ts'

/** The crew jobs a film page shows besides its directors, in the order it shows them. */
export const CREW_JOBS = ['Writer', 'Cinematography', 'Composer', 'Editor', 'Producer'] as const
export type CrewJob = (typeof CREW_JOBS)[number]

/** A cinema as the owner described it; the shared counting keeps only the name, owner, country, city and website. */
export type Cinema = WatchPlace

/** One viewing, as the film log has it, with the film and the cinema TMDB and the cinema list matched to it. */
export type Viewing = WatchViewing<FilmInfo>

/** The film's words for the shared counting, and every count bound to them. */
export const FILM: WatchConfig<'film', 'cinema'> = {
  noun: words.noun,
  itemKind: words.itemKind,
  placeKind: words.placeKind,
  leadJob: 'Director',
  crewJobs: CREW_JOBS,
}

const core = watchCore(FILM)

const peopleOf = (credits: ReturnType<typeof creditsOf>): ItemLink[] => credits.map((credit) => ({ name: credit.name, slug: core.personSlug(credit) }))

/** The page of one film, or `null` for a key no viewing has. */
export function filmPageOf(viewings: readonly Viewing[], key: string): ItemPage | null {
  const own = viewings.filter((viewing) => itemKey(viewing) === key)
  const latest = own.at(-1)
  if (latest === undefined) return null
  const film = latest.item
  return {
    kind: 'item',
    slug: core.itemSlug(key),
    title: film?.title ?? latest.title,
    year: film?.year ?? latest.year,
    originalTitle: film?.originalTitle != null && film.originalTitle !== film.title ? film.originalTitle : null,
    overview: film?.overview ?? null,
    tagline: film?.tagline ?? null,
    cover: posterUrl(film),
    backdrop: backdropUrl(film),
    facts: filmFacts(film),
    links: filmLinks(film),
    lead: peopleOf(creditsOf(film, 'Director')),
    cast: creditsOf(film, 'Cast').map((credit) => ({ name: credit.name, slug: core.personSlug(credit), character: credit.character })),
    crew: CREW_JOBS.map((job) => ({ job, people: peopleOf(creditsOf(film, job)) })).filter((group) => group.people.length > 0),
    seen: core.seenOf(own),
    keywords: film?.keywords ?? [],
    ownership: null,
    related: [],
    franchise: null,
  }
}
