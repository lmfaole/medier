/**
 * What the film app says: the shape of what TMDB says about a film (`FilmInfo`), the words of every page
 * (`@designsystem/watch/words`, shared with TV) and the register's own facts of one film, which travel with the
 * answer so the shared page of a film needs no film code.
 */

import { NOTHING_IN_PERIOD } from '@designsystem/ui/lib/empty-states'
import { formatCount, formatDay, formatHoursAndMinutes, languageName } from '@designsystem/intl/listening'
import { formatNumber, formatRating } from '@designsystem/intl/number'
import { appNavLabel } from '@designsystem/ui/lib/apps'
import type { Fact, WatchItem } from '@designsystem/watch/viewing'
import { type WatchWords } from '@designsystem/watch/words'

/** What the register says about one film, besides the shared part (`WatchItem`). */
export interface FilmInfo extends WatchItem {
  originalTitle: string | null
  overview: string | null
  tagline: string | null
  language: string | null
  voteAverage: number | null
  voteCount: number | null
  budget: number | null
  revenue: number | null
  imdbId: string | null
  wikidataId: string | null
  certification: string | null
  releasedNo: string | null
  collection: string | null
  companies: string[]
  keywords: string[]
}

const NOUN = { one: 'film', many: 'filmer' }
/** 60000000 → «60 mill. USD»: the register counts money in US dollars. */
function formatDollars(amount: number): string {
  return `${formatNumber(amount, 'nb-NO', { notation: 'compact', maximumFractionDigits: 1 })} USD`
}

export const words = {
  title: 'Film',
  itemKind: 'film',
  placeKind: 'cinema',
  noun: NOUN,
  front: {
    lead: 'Det jeg har sett: loggen min, med fakta fra filmregisteret TMDB.',
    empty: 'Ingen filmer i loggen ennå.',
    itemsLabel: 'Filmer',
    viewingsDetail: (viewings: number) => `${formatCount(viewings)} visninger`,
    timeDetail: 'Der spilletiden er kjent',
    yearChartValue: 'Visninger',
    pagesLabel: appNavLabel('film'),
    leadTitle: 'Regissørene du har sett mest',
    leadEmpty: 'Ingen regissører ennå: kjør tmdb-jobben.',
    placesTitle: 'Kinoene du har vært på',
    placesEmpty: NOTHING_IN_PERIOD,
  },
  entity: {
    itemTitle: 'Film',
    lead: (names: string) => `Regissert av ${names}.`,
    placeLead: (place) => [place.city, place.country].filter(Boolean).join(', ') || 'Kino',
    placeTiles: (place) => [
      { label: 'Besøk', value: { n: place.visits } },
      ...(place.first === null ? [] : [{ label: 'Første besøk', value: { day: place.first } }]),
      ...(place.last === null ? [] : [{ label: 'Siste besøk', value: { day: place.last } }]),
    ],
    placeFacts: (place) => [
      ['Eier', place.owner],
      ['By', place.city],
      ['Land', place.country],
    ],
    placeLinks: (place) => [['Kinoens hjemmeside', place.website]],
    placeTitle: (name: string) => `Filmene du har sett på ${name}.`,
  },
} satisfies WatchWords<'film', 'cinema'>

/** TMDB writes «NR» for a film nobody has rated; to the page that is no age rating at all. */
function certificationText(certification: string | null | undefined): string | null {
  if (certification == null || certification === 'NR') return null
  return /^\d+$/.test(certification) ? `${certification} år` : certification
}

/** The register's own facts of one film, in the order its page shows them. */
export function filmFacts(film: FilmInfo | null): readonly Fact[] {
  return [
    ['Spilletid', film?.runtimeMinutes == null ? null : formatHoursAndMinutes(film.runtimeMinutes)],
    ['Sjanger', film?.genres.join(', ') ?? ''],
    ['Land', film?.countries.join(', ') ?? ''],
    ['Språk', film?.language == null ? null : languageName(film.language)],
    ['Talt', film !== null && film.languages.length > 1 ? film.languages.join(', ') : null],
    ['Aldersgrense', certificationText(film?.certification)],
    ['Utgitt i Norge', film?.releasedNo == null ? null : formatDay(film.releasedNo)],
    ['TMDB-snitt', film?.voteAverage == null ? null : `${formatRating(film.voteAverage)} av 10${film.voteCount === null ? '' : `, ${formatCount(film.voteCount)} stemmer`}`],
    ['Budsjett', film?.budget == null ? null : formatDollars(film.budget)],
    ['Inntekter', film?.revenue == null ? null : formatDollars(film.revenue)],
    ['Samling', film?.collection ?? null],
    ['Selskaper', film?.companies.join(', ') ?? ''],
  ]
}

/** Where one film is also to be found, `null` where the register has nothing. */
export function filmLinks(film: FilmInfo | null): readonly Fact[] {
  return [
    ['IMDb', film?.imdbId == null ? null : `https://www.imdb.com/title/${film.imdbId}/`],
    ['TMDB', film?.tmdbId == null ? null : `https://www.themoviedb.org/movie/${film.tmdbId}`],
    ['Wikidata', film?.wikidataId == null ? null : `https://www.wikidata.org/wiki/${film.wikidataId}`],
  ]
}
