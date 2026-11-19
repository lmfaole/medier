/**
 * What the TV app says: the shape of what TMDB says about a series (`TvInfo`), the words of every page
 * (`@designsystem/watch/words`, shared with film) and the register's own facts of one series, which travel with the
 * answer so the shared page of a series needs no TV code of its own.
 */

import { NOTHING_IN_PERIOD } from '@designsystem/ui/lib/empty-states'
import { formatRating } from '@designsystem/intl/number'
import { formatCount, formatDay, formatHoursAndMinutes, languageName } from '@designsystem/intl/listening'
import { appNavLabel } from '@designsystem/ui/lib/apps'
import type { Fact, WatchItem } from '@designsystem/watch/viewing'
import { countedItems, type WatchWords } from '@designsystem/watch/words'

/** What the register says about one series, besides the shared part (`WatchItem`). */
export interface TvInfo extends WatchItem {
  originalTitle: string | null
  overview: string | null
  tagline: string | null
  language: string | null
  voteAverage: number | null
  voteCount: number | null
  imdbId: string | null
  wikidataId: string | null
  firstAirDate: string | null
  lastAirDate: string | null
  seasons: number | null
  episodes: number | null
  status: string | null
  inProduction: boolean
  homepage: string | null
  companies: string[]
  keywords: string[]
  /** The next episode TVmaze announces, or none. */
  next: { season: number | null; episode: number | null; name: string | null; airDate: string | null } | null
}

const SERIES = { one: 'serie', many: 'serier' }
const EPISODES = { one: 'episode', many: 'episoder' }
export const words = {
  title: 'TV-serier',
  itemKind: 'serie',
  placeKind: 'network',
  noun: SERIES,
  front: {
    lead: 'Det jeg har sett: loggen min, episode for episode, med fakta fra TV-registeret TMDB.',
    empty: 'Ingen episoder i loggen ennå.',
    itemsLabel: 'Serier',
    viewingsDetail: (viewings: number) => countedItems(EPISODES, viewings),
    timeDetail: 'Der episodelengden er kjent',
    yearChartValue: 'Episoder',
    pagesLabel: appNavLabel('tv'),
    leadTitle: 'Serieskaperne du har sett mest',
    leadEmpty: 'Ingen serieskapere ennå: kjør tmdb-jobben.',
    placesTitle: 'Nettverkene du har sett fra',
    placesEmpty: NOTHING_IN_PERIOD,
  },
  entity: {
    itemTitle: 'Serie',
    lead: (names: string) => `Skapt av ${names}.`,
    placeLead: (place) => place.country ?? 'Nettverk',
    placeTiles: (place) => [
      { label: 'Episoder sett', value: { n: place.visits } },
      ...(place.first === null ? [] : [{ label: 'Første episode', value: { day: place.first } }]),
      ...(place.last === null ? [] : [{ label: 'Siste episode', value: { day: place.last } }]),
    ],
    placeFacts: (place) => [
      ['Land', place.country],
    ],
    placeLinks: () => [],
    placeTitle: (name: string) => `Seriene du har sett fra ${name}.`,
  },
} satisfies WatchWords<'serie', 'network'>

/** The register's status of a series, in Norwegian where it is one of its words. */
const STATUS: Record<string, string> = { 'Returning Series': 'Pågår', Ended: 'Avsluttet', Canceled: 'Kansellert', 'In Production': 'Under produksjon', Planned: 'Planlagt', Pilot: 'Pilot' }

/** «18. feb. 2022 – 20. mars 2025», and «18. feb. 2022 –» while the register says more is coming. */
function aired(series: TvInfo | null): string | null {
  if (series?.firstAirDate == null) return null
  const first = formatDay(series.firstAirDate)
  return series.inProduction || series.lastAirDate == null ? `${first} –` : `${first} – ${formatDay(series.lastAirDate)}`
}

/** «Sesong 5, episode 5: Hvem spiser hvem først?», or none when no episode is announced. */
function nextEpisode(series: TvInfo | null): string | null {
  const next = series?.next
  if (next == null || next.airDate == null) return null
  const place = next.season === null || next.episode === null ? '' : `Sesong ${next.season}, episode ${next.episode}`
  return place === '' ? null : next.name === null ? place : `${place}: ${next.name}`
}

/** The day the next episode is shown, or none when none is announced. */
function nextAirDay(series: TvInfo | null): string | null {
  const next = series?.next
  return next == null || next.airDate == null ? null : formatDay(next.airDate)
}

/** The register's own facts of one series, in the order its page shows them. */
export function seriesFacts(series: TvInfo | null): readonly Fact[] {
  return [
    ['Episodelengde', series?.runtimeMinutes == null ? null : formatHoursAndMinutes(series.runtimeMinutes)],
    ['Sesonger', series?.seasons == null ? null : formatCount(series.seasons)],
    ['Episoder', series?.episodes == null ? null : formatCount(series.episodes)],
    ['Sjanger', series?.genres.join(', ') ?? ''],
    ['Land', series?.countries.join(', ') ?? ''],
    ['Språk', series?.language == null ? null : languageName(series.language)],
    ['Talt', series !== null && series.languages.length > 1 ? series.languages.join(', ') : null],
    ['Sendt', aired(series)],
    ['Neste episode', nextEpisode(series)],
    ['Sendes', nextAirDay(series)],
    ['Status', series?.status == null ? null : (STATUS[series.status] ?? series.status)],
    ['TMDB-snitt', series?.voteAverage == null ? null : `${formatRating(series.voteAverage)} av 10${series.voteCount === null ? '' : `, ${formatCount(series.voteCount)} stemmer`}`],
    ['Selskaper', series?.companies.join(', ') ?? ''],
  ]
}

/** Where one series is also to be found, `null` where the register has nothing. */
export function seriesLinks(series: TvInfo | null): readonly Fact[] {
  return [
    ['IMDb', series?.imdbId == null ? null : `https://www.imdb.com/title/${series.imdbId}/`],
    ['TMDB', series?.tmdbId == null ? null : `https://www.themoviedb.org/tv/${series.tmdbId}`],
    ['Wikidata', series?.wikidataId == null ? null : `https://www.wikidata.org/wiki/${series.wikidataId}`],
    ['Nettside', series?.homepage ?? null],
  ]
}
