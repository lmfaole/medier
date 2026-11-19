/**
 * The counting behind a watch log, shared by the apps that keep one (film, TV): the best rated, the
 * people, genres, countries, decades and places that come most, the days and months, and the
 * page of one item, one person or one place. A viewing has its day written as in the log (`YYYY-MM-DD`), so
 * nothing here depends on a time zone.
 *
 * What differs between two such apps is only its words and which credit job leads an item: `watchCore` binds those
 * once and returns every count below already speaking that app's language. Everything is a pure function of a list
 * of viewings.
 */

import { countryName, playsPerYear } from '@designsystem/intl/listening'
import { newestFirst as newestLibraryFirst, type LibraryWork } from '@designsystem/ui/lib/library'
import { normalizeTitle, slugOf } from '@designsystem/intl/text'
import type { Ownership } from '@designsystem/ui/lib/ownership'
import { seatParts } from './format.ts'

/** A lead person has gone quiet after three months with none of their work, once they had three viewings. */

export interface Person {
  id: number
  name: string
}

/** What the register says about a person, besides the name. */
export interface PersonInfo {
  birthday: string | null
  deathday: string | null
  placeOfBirth: string | null
  biography: string | null
  biographyLanguage: string | null
  department: string | null
  imdbId: string | null
}

/** One credit of an item: `job` is the register's (`Director`, `Cast`, `Writer`, …), `character` only the cast's. */
export interface Credit {
  id: number
  name: string
  job: string
  character: string | null
}

/** What the register says about one item (a film, a series), as the counting below needs it. */
export interface WatchItem {
  tmdbId: number
  title: string
  year: number | null
  runtimeMinutes: number | null
  posterPath: string | null
  /** The wide picture, a file name with a leading slash. */
  backdropPath: string | null
  genres: string[]
  countries: string[]
  /** The languages spoken in it, in Norwegian. */
  languages: string[]
  credits: Credit[]
}

/** Where an item was seen (a cinema, a streaming service), as a viewing's log names it. */
export interface WatchPlace {
  name: string
  owner: string | null
  country: string | null
  city: string | null
  website: string | null
  /** A photo of it, as the app serves it (`/cinemas/<file>`), where there is one. */
  image?: string | null
}

/** One episode of a series; `null` on a viewing of an app that has no episodes (a film). */
export interface Episode {
  season: number | null
  episode: number | null
}

/** One line of the log, with the item and the place the register matched to it. */
export interface WatchViewing<Item extends WatchItem = WatchItem> {
  id: number
  /** The day as the log writes it (`YYYY-MM-DD`), or `null` when it is not known. */
  on: string | null
  /** The log's own title and year, used when the register has nothing. */
  title: string
  year: number | null
  rating: number | null
  rewatch: boolean
  tmdbId: number | null
  item: Item | null
  place: WatchPlace | null
  /** Where in the hall it was sat, as the ticket says; only a film's cinema viewings have one. */
  seat?: string | null
  episode: Episode | null
}

/** What an app says and which job leads an item; `watchCore` speaks it. */
export interface WatchConfig<ItemKind extends string = string, PlaceKind extends string = string> {
  /** The words for the things watched: `film`/`filmer`, `serie`/`serier`. */
  noun: { one: string; many: string }
  /** The kind on a slug and in the entity index: `film`, `serie`. */
  itemKind: ItemKind
  /** The kind of a place: `cinema`, `network`. */
  placeKind: PlaceKind
  /** The credit job that leads an item: `Director` for a film, `Creator` for a series. */
  leadJob: string
  /** The crew jobs an item's page shows besides its lead, in the order it shows them. */
  crewJobs: readonly string[]
}

export interface Totals {
  plays: number
  works: number
  minutes: number
  rated: number
  averageRating: number | null
  firstOn: string | null
  lastOn: string | null
}

/** One item of the log, each once, with how it was rated and how often it was seen. */
export interface Listing {
  key: string
  slug: string
  title: string
  year: number | null
  rating: number | null
  /** How many times it was seen in the viewings counted. */
  plays: number
  cover: string | null
}

export interface Group {
  name: string
  /** The page of a person or a place, or `null` for a genre, a country or a decade. */
  slug: string | null
  kind: 'person' | 'place' | null
  works: number
}

/** A visit the calendar has from today on: the film, the day, the time and the cinema where it is known. */
export interface PlannedVisit {
  on: string
  at: string | null
  title: string
  cinema: string | null
}

/** What the front page answers: the totals, the years, the best rated, the lead people and the latest viewings. */
export interface Overview {
  totals: Totals
  years: { year: number; plays: number }[]
  best: Listing[]
  lead: Group[]
  /** The latest viewings with a known day, newest first. */
  recent: RecentViewing[]
  /** What the calendar has planned from today on, soonest first; none for an app without a calendar. */
  planned: PlannedVisit[]
  /** Viewings per calendar month from the first to the last, every month between them, oldest first. */
  months: { month: string; plays: number }[]
  /** Viewings per weekday, Monday first. */
  weekdays: number[]
  actors: Group[]
  genres: Group[]
  countries: Group[]
  languages: Group[]
  decades: Group[]
  places: Group[]
}

/** One line of the history: a viewing as the log has it, on a day the log knows. */
export interface HistoryRow {
  on: string
  slug: string
  title: string
  year: number | null
  rating: number | null
  rewatch: boolean
  episode: Episode | null
  place: string | null
  /** The poster as the app serves it, `null` where the register has none. */
  cover: string | null
  /** The names of the item's lead credits (the director, the creator), `null` where the register has none. */
  creator: string | null
}

/** What the history answers: every viewing of one year, with the year chosen and the years to choose from. */
export interface History {
  year: string
  years: string[]
  plays: HistoryRow[]
}

/** One line of the collection: a work the owner has or wants, with what the register matched it to. */
export interface WatchCollectionLine<Item extends WatchItem = WatchItem> {
  title: string
  year: number | null
  status: 'owned' | 'want'
  rating: number | null
  /** The day the line was added to the collection, or none. */
  addedOn: string | null
  tmdbId: number | null
  /** What the owner has (`blu-ray`, `digital`), or none. */
  format: string | null
  item: Item | null
}

/** One of the latest viewings, as the front page lists it. */
export interface RecentViewing {
  slug: string
  title: string
  year: number | null
  on: string
  rating: number | null
  /** The time and the cinema of a visit the calendar has for that day and film, else `null`. */
  at: string | null
  cinema: string | null
  /** The poster path the app serves, or `null`. */
  poster: string | null
  /** The episode, on an app whose log has them (`null` for a film). */
  episode: Episode | null
}

export interface EntitySummary<ItemKind extends string = string, PlaceKind extends string = string> {
  kind: ItemKind | 'person' | PlaceKind
  slug: string
  name: string
  /** The year of an item; `null` for a person or a place. */
  year: number | null
}

export interface Seen {
  /** `null` when the day is not known. */
  on: string | null
  rating: number | null
  rewatch: boolean
  place: { name: string; slug: string } | null
  /** Where in the hall it was sat, as the ticket says. */
  seat: string | null
  episode: Episode | null
}

export interface ItemLink {
  name: string
  slug: string
}

/** One labelled fact of a page: what it is called and what it says; `null` leaves the row out. */
export type Fact = readonly [string, string | null]

export interface PersonPage {
  kind: 'person'
  slug: string
  name: string
  /** What the items seen of the person were: led, acted in, or crewed. */
  lead: Listing[]
  acted: Listing[]
  /** The other jobs, one group for each. */
  crewed: { job: string; works: Listing[] }[]
  tmdbId: number
  born: string | null
  died: string | null
  placeOfBirth: string | null
  department: string | null
  biography: string | null
  biographyLanguage: string | null
  imdbId: string | null
}

/**
 * What every app's own page of one item shows, whatever its register calls it (`FilmPage`, `TvPage`). The register's
 * own facts and links are computed by the app's server module and travel with the answer, so the page itself is the
 * same three for film and TV: `kind` is `'item'`, `'person'` and `'place'` are the other two.
 */
/** A work the register recommends beside the one on the page: its page when the owner has it, and whether it has been seen. */
export interface RelatedWork {
  title: string
  year: number | null
  slug: string | null
  seen: boolean
}

/** One part of a franchise; `current` marks the part whose page it is shown on. */
export interface FranchisePart {
  title: string
  year: number | null
  slug: string | null
  /** The poster as the app serves it, `null` where the register has none. */
  cover: string | null
  seen: boolean
  current: boolean
}

/** A franchise and how much of it has been seen, the first part first. */
export interface FranchiseShelf {
  name: string
  /** The franchise's wide picture as the app serves it, for behind its card. */
  backdrop: string | null
  seen: number
  total: number
  parts: FranchisePart[]
}

export interface ItemPage {
  kind: 'item'
  slug: string
  title: string
  year: number | null
  originalTitle: string | null
  overview: string | null
  tagline: string | null
  cover: string | null
  /** The wide picture as the app serves it, for the head of the page. */
  backdrop: string | null
  /** The register's own facts of this item, in the order its page shows them. */
  facts: readonly Fact[]
  /** Where the item is also to be found (IMDb, TMDB, Wikidata), `null` where the register has nothing. */
  links: readonly Fact[]
  lead: ItemLink[]
  cast: { name: string; slug: string; character: string | null }[]
  crew: { job: string; people: ItemLink[] }[]
  /** Every viewing, newest first. */
  seen: Seen[]
  keywords: string[]
  /** The owner's copy, from the collection: set by the API, none from the page builder. */
  ownership: Ownership | null
  /** What the register recommends beside it, best first: set by the API, none from the page builder. */
  related: RelatedWork[]
  /** The franchise it belongs to, where the register has one: set by the API, none from the page builder. */
  franchise: FranchiseShelf | null
}

/** The page of one place (a cinema, a network); only the name is shared, the rest is the app's own. */
export interface PlacePage {
  kind: 'place'
  slug: string
  name: string
  owner: string | null
  city: string | null
  country: string | null
  website: string | null
  /** A photo of the place, as the app serves it, or `null`. */
  image: string | null
  /** Every visit counts, an item seen again too. */
  visits: number
  /** The first and the last visit with a known day. */
  first: string | null
  last: string | null
  /** The works seen there, newest first, each with how many times it was seen there. */
  works: Listing[]
  /** The same visits split by hall, the most visited first and the visits with no hall last (`name` is `null`); empty when no visit names a hall. */
  halls: HallVisits[]
}

/** The visits to one hall of a cinema (or to the visits that name none), with the works seen there, newest first. */
export interface HallVisits {
  name: string | null
  visits: number
  works: Listing[]
}

export type Dated<Item extends WatchItem = WatchItem> = WatchViewing<Item> & { on: string }

const BIOGRAPHY_LENGTH = 700
const POSTER_FILE = /^\/[A-Za-z0-9_-]+\.jpg$/

/** A biography cut at the last sentence that ends before the limit, or at the limit with an ellipsis. */
export function excerpt(text: string, limit = BIOGRAPHY_LENGTH): string {
  if (text.length <= limit) return text
  const head = text.slice(0, limit)
  const end = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '))
  return end > limit / 2 ? head.slice(0, end + 1) : `${head.trimEnd()}…`
}

/** One item, wherever it was seen: the register's number, else the log's title and year. */
export function itemKey(viewing: Pick<WatchViewing, 'tmdbId' | 'title' | 'year'>): string {
  return viewing.tmdbId === null ? `l:${normalizeTitle(viewing.title)}:${viewing.year ?? 0}` : `t${viewing.tmdbId}`
}

/** The poster as the app serves it, `/posters/<file>`, or `null` where there is none or the name is not a plain file. */
export function posterUrl(item: Pick<WatchItem, 'posterPath'> | null | undefined): string | null {
  return item?.posterPath != null && POSTER_FILE.test(item.posterPath) ? `/posters${item.posterPath}` : null
}

/** The wide picture as the app serves it, `/backdrops/<file>`, or `null` where there is none or the name is not a plain file. */
export function backdropUrl(item: Pick<WatchItem, 'backdropPath'> | null | undefined): string | null {
  return item?.backdropPath != null && POSTER_FILE.test(item.backdropPath) ? `/backdrops${item.backdropPath}` : null
}

/** The viewings whose day is known: what the days, months and years are counted from. One without still counts as seen. */
export const datedOf = <Item extends WatchItem>(viewings: readonly WatchViewing<Item>[]): Dated<Item>[] =>
  viewings.filter((viewing): viewing is Dated<Item> => viewing.on !== null)

/** The credits of an item with one job, or all of them. */
export const creditsOf = (item: WatchItem | null | undefined, job?: string): Credit[] =>
  item === null || item === undefined ? [] : job === undefined ? item.credits : item.credits.filter((credit) => credit.job === job)

/** Everyone credited on an item, without repeats. */
export function creditedOf(item: WatchItem | null | undefined): Person[] {
  const known = new Map<number, Person>()
  for (const credit of creditsOf(item)) known.set(credit.id, { id: credit.id, name: credit.name })
  return [...known.values()]
}

const yearOfDay = (day: string) => day.slice(0, 4)
const monthOfDay = (day: string) => day.slice(0, 7)

export function totalsOf(viewings: readonly WatchViewing[]): Totals {
  const dated = datedOf(viewings)
  const rated = viewings.filter((viewing) => viewing.rating !== null)
  return {
    plays: viewings.length,
    works: new Set(viewings.map(itemKey)).size,
    minutes: viewings.reduce((sum, viewing) => sum + (viewing.item?.runtimeMinutes ?? 0), 0),
    rated: rated.length,
    averageRating: rated.length === 0 ? null : Math.round((rated.reduce((sum, viewing) => sum + (viewing.rating ?? 0), 0) / rated.length) * 100) / 100,
    firstOn: dated[0]?.on ?? null,
    lastOn: dated.at(-1)?.on ?? null,
  }
}

/** The items of the viewings, each once, with the rating of its latest viewing that has one. */
export function listingsOf<Item extends WatchItem>(viewings: readonly WatchViewing<Item>[], itemSlug: (key: string) => string): Listing[] {
  const items = new Map<string, Listing>()
  for (const viewing of viewings) {
    const key = itemKey(viewing)
    const before = items.get(key)
    items.set(key, {
      key,
      slug: itemSlug(key),
      title: viewing.item?.title ?? viewing.title,
      year: viewing.item?.year ?? viewing.year,
      rating: viewing.rating ?? before?.rating ?? null,
      plays: (before?.plays ?? 0) + 1,
      cover: posterUrl(viewing.item),
    })
  }
  return [...items.values()]
}

/** The things the items have (people, genres, …) ranked by how many different items have them. */
export function ranked<Item extends WatchItem>(viewings: readonly WatchViewing<Item>[], keysOf: (viewing: WatchViewing<Item>) => Omit<Group, 'works'>[], limit: number): Group[] {
  const seen = new Map<string, Omit<Group, 'works'> & { works: Set<string> }>()
  for (const viewing of viewings) {
    for (const key of keysOf(viewing)) {
      const entry = seen.get(key.name) ?? { ...key, works: new Set<string>() }
      entry.works.add(itemKey(viewing))
      seen.set(key.name, entry)
    }
  }
  return [...seen.values()]
    .map(({ name, slug, kind, works }) => ({ name, slug, kind, works: works.size }))
    .toSorted((a, b) => b.works - a.works || a.name.localeCompare(b.name))
    .slice(0, limit)
}

const plain = (names: readonly string[]): Omit<Group, 'works'>[] => names.map((name) => ({ name, slug: null, kind: null }))

/** Viewings per year, every year from the first to the last, so a year with none is a column of zero. */
export function perYear(viewings: readonly WatchViewing[]): { year: number; plays: number }[] {
  return playsPerYear(datedOf(viewings).map((viewing) => Number(yearOfDay(viewing.on))))
}

/** Viewings per calendar month of one year's viewings, twelve entries, January first. */
export function perMonth(viewings: readonly WatchViewing[]): number[] {
  const months = Array.from({ length: 12 }, () => 0)
  for (const viewing of datedOf(viewings)) {
    const index = Number(viewing.on.slice(5, 7)) - 1
    months[index] = (months[index] ?? 0) + 1
  }
  return months
}

/** Viewings per weekday, seven entries, Monday first. */
/** Viewings per calendar month from the first month with a viewing to the last, the months between them with 0. */
export function perCalendarMonth(viewings: readonly WatchViewing[]): { month: string; plays: number }[] {
  const counts = new Map<string, number>()
  for (const viewing of datedOf(viewings)) counts.set(viewing.on.slice(0, 7), (counts.get(viewing.on.slice(0, 7)) ?? 0) + 1)
  const months = [...counts.keys()].toSorted()
  const first = months[0]
  const last = months.at(-1)
  if (first === undefined || last === undefined) return []
  const result: { month: string; plays: number }[] = []
  let [year, month] = [Number(first.slice(0, 4)), Number(first.slice(5, 7))]
  for (;;) {
    const key = `${year}-${String(month).padStart(2, '0')}`
    result.push({ month: key, plays: counts.get(key) ?? 0 })
    if (key === last) return result
    month += 1
    if (month > 12) [year, month] = [year + 1, 1]
  }
}

export function perWeekday(viewings: readonly WatchViewing[]): number[] {
  const days = Array.from({ length: 7 }, () => 0)
  for (const viewing of datedOf(viewings)) {
    const index = (new Date(`${viewing.on}T00:00:00Z`).getUTCDay() + 6) % 7
    days[index] = (days[index] ?? 0) + 1
  }
  return days
}

export const monthsOf = (viewings: readonly WatchViewing[]): string[] => [...new Set(datedOf(viewings).map((viewing) => monthOfDay(viewing.on)))].toSorted().toReversed()
export const yearsOf = (viewings: readonly WatchViewing[]): string[] => [...new Set(datedOf(viewings).map((viewing) => yearOfDay(viewing.on)))].toSorted().toReversed()

/**
 * The counting of one app's log, in that app's words: bind the config once and every function below speaks it.
 * A new app of the same shape (a log of what was watched, a register keyed by its number) is a `WatchConfig`.
 */
export function watchCore<ItemKind extends string, PlaceKind extends string>(config: WatchConfig<ItemKind, PlaceKind>) {
  const itemSlug = (key: string) => slugOf(`${config.itemKind}\u0000${key}`)
  const placeSlug = (name: string) => slugOf(`${config.placeKind}\u0000${name}`)
  const personSlug = (person: Person) => slugOf(`person\u0000${person.id}`)
  const placesOf = (viewing: WatchViewing): WatchPlace[] => (viewing.place === null ? [] : [viewing.place])
  const people = (list: readonly Person[]): Omit<Group, 'works'>[] => list.map((person) => ({ name: person.name, slug: personSlug(person), kind: 'person' }))

  const listings = (viewings: readonly WatchViewing[]) => listingsOf(viewings, itemSlug)

  /** Every item seen once and every item of the collection, as the library every app has: the one seen last first and the ones with no day last. */
  const libraryOf = (viewings: readonly WatchViewing[], collection: readonly WatchCollectionLine[] = []): { works: LibraryWork[] } => {
    const byKey = new Map<string, WatchViewing[]>()
    for (const viewing of viewings) byKey.set(itemKey(viewing), [...(byKey.get(itemKey(viewing)) ?? []), viewing])
    const works = listings(viewings).map((listing): LibraryWork => {
      const own = byKey.get(listing.key) ?? []
      const days = own.flatMap((viewing) => (viewing.on === null ? [] : [viewing.on])).toSorted()
      const item = own.find((viewing) => viewing.item !== null)?.item ?? null
      return {
        kind: config.itemKind,
        slug: listing.slug,
        title: listing.title,
        creator: creditsOf(item, config.leadJob).map((credit) => credit.name).join(', ') || null,
        year: listing.year,
        cover: listing.cover,
        status: 'done',
        owned: false,
        rating: listing.rating,
        plays: listing.plays,
        firstOn: days[0] ?? null,
        lastOn: days.at(-1) ?? null,
        genres: item?.genres ?? [],
      }
    })
    const known = new Map(works.map((work) => [work.slug, work]))
    for (const line of collection) {
      const slug = itemSlug(itemKey(line))
      const seen = known.get(slug)
      if (seen !== undefined) {
        if (line.status === 'owned') {
          seen.owned = true
          seen.format ??= line.format
        }
        continue
      }
      known.set(slug, {
        kind: config.itemKind,
        slug: itemSlug(itemKey(line)),
        title: line.item?.title ?? line.title,
        creator: creditsOf(line.item, config.leadJob).map((credit) => credit.name).join(', ') || null,
        year: line.item?.year ?? line.year,
        cover: posterUrl(line.item),
        status: line.status,
        owned: line.status === 'owned',
        format: line.format,
        rating: line.rating,
        plays: 0,
        firstOn: null,
        lastOn: null,
        genres: line.item?.genres ?? [],
      })
    }
    return { works: [...known.values()].toSorted(newestLibraryFirst) }
  }

  /** The lines of the collection for a work no viewing has: a work the owner has or wants and has not seen, one line each (the one that is owned first). */
  const unseenOf = <Item extends WatchItem>(viewings: readonly WatchViewing[], collection: readonly WatchCollectionLine<Item>[]): WatchCollectionLine<Item>[] => {
    const seen = new Set(viewings.map(itemKey))
    const lines = new Map<string, WatchCollectionLine<Item>>()
    for (const line of collection) {
      const key = itemKey(line)
      if (!seen.has(key) && (!lines.has(key) || line.status === 'owned')) lines.set(key, line)
    }
    return [...lines.values()]
  }

  /** The best rated items, ties by the most seen; items never rated are not ranked. */
  const topRated = (viewings: readonly WatchViewing[], limit: number): Listing[] =>
    listings(viewings)
      .filter((item) => item.rating !== null)
      .toSorted((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.plays - a.plays || a.title.localeCompare(b.title))
      .slice(0, limit)

  const topLead = (viewings: readonly WatchViewing[], limit: number) => ranked(viewings, (viewing) => people(creditsOf(viewing.item, config.leadJob)), limit)
  const topActors = (viewings: readonly WatchViewing[], limit: number) => ranked(viewings, (viewing) => people(creditsOf(viewing.item, 'Cast').slice(0, 5)), limit)
  const topGenres = (viewings: readonly WatchViewing[], limit: number) => ranked(viewings, (viewing) => plain(viewing.item?.genres ?? []), limit)
  const topCountries = (viewings: readonly WatchViewing[], limit: number) => ranked(viewings, (viewing) => plain(viewing.item?.countries ?? []), limit)
  const topLanguages = (viewings: readonly WatchViewing[], limit: number) => ranked(viewings, (viewing) => plain(viewing.item?.languages ?? []), limit)
  const topPlaces = (viewings: readonly WatchViewing[], limit: number) =>
    ranked(viewings, (viewing) => placesOf(viewing).map((place): Omit<Group, 'works'> => ({ name: place.name, slug: placeSlug(place.name), kind: 'place' })), limit)
  const yearOfItem = (viewing: WatchViewing) => viewing.item?.year ?? viewing.year
  const topDecades = (viewings: readonly WatchViewing[], limit: number) =>
    ranked(viewings, (viewing) => plain(yearOfItem(viewing) === null ? [] : [`${Math.floor((yearOfItem(viewing) ?? 0) / 10) * 10}-tallet`]), limit)

  /** Every item seen, everyone credited on one and every place, items first by title, then people and places by name. */
  const entitiesOf = (viewings: readonly WatchViewing[]): EntitySummary<ItemKind, PlaceKind>[] => {
    const items = listings(viewings)
    const known = new Map<number, Person>()
    for (const viewing of viewings) for (const person of creditedOf(viewing.item)) known.set(person.id, { id: person.id, name: person.name })
    return [
      ...items.toSorted((a, b) => a.title.localeCompare(b.title) || (a.year ?? 0) - (b.year ?? 0)).map((item): EntitySummary<ItemKind, PlaceKind> => ({ kind: config.itemKind, slug: item.slug, name: item.title, year: item.year })),
      ...[...known.values()].toSorted((a, b) => a.name.localeCompare(b.name)).map((person): EntitySummary<ItemKind, PlaceKind> => ({ kind: 'person', slug: personSlug(person), name: person.name, year: null })),
      ...[...new Set(viewings.flatMap((viewing) => placesOf(viewing).map((place) => place.name)))].toSorted((a, b) => a.localeCompare(b)).map((name): EntitySummary<ItemKind, PlaceKind> => ({ kind: config.placeKind, slug: placeSlug(name), name, year: null })),
    ]
  }

  /** The page of one person, or `null` for one no item seen has. */
  const personPageOf = (viewings: readonly WatchViewing[], personId: number, info: PersonInfo | undefined): PersonPage | null => {
    const withJob = (job: string) => viewings.filter((viewing) => creditsOf(viewing.item, job).some((credit) => credit.id === personId))
    const led = withJob(config.leadJob)
    const acted = withJob('Cast')
    const crewed = config.crewJobs.map((job) => ({ job, seen: withJob(job) }))
    const name = [...led, ...acted, ...crewed.flatMap((group) => group.seen)].flatMap((viewing) => creditedOf(viewing.item)).find((person) => person.id === personId)?.name
    if (name === undefined) return null
    const byYear = (items: Listing[]) => items.toSorted((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title))
    return {
      kind: 'person',
      slug: personSlug({ id: personId, name }),
      name,
      lead: byYear(listings(led)),
      acted: byYear(listings(acted)),
      crewed: crewed.filter((group) => group.seen.length > 0).map((group) => ({ job: group.job, works: byYear(listings(group.seen)) })),
      tmdbId: personId,
      born: info?.birthday ?? null,
      died: info?.deathday ?? null,
      placeOfBirth: info?.placeOfBirth ?? null,
      department: info?.department ?? null,
      biography: info?.biography == null ? null : excerpt(info.biography),
      biographyLanguage: info?.biographyLanguage ?? null,
      imdbId: info?.imdbId ?? null,
    }
  }

  /** The page of one place, or `null` for one no viewing names. */
  const placePageOf = (viewings: readonly WatchViewing[], slug: string): PlacePage | null => {
    const here = viewings.filter((viewing) => viewing.place !== null && placeSlug(viewing.place.name) === slug)
    const place = here[0]?.place
    if (place == null) return null
    const dated = datedOf(here)
    const latestOn = new Map<string, string>()
    for (const viewing of dated) latestOn.set(itemKey(viewing), viewing.on)
    const newestFirst = (items: readonly WatchViewing[]): Listing[] => listings(items).toSorted((a, b) => (latestOn.get(b.key) ?? '').localeCompare(latestOn.get(a.key) ?? '') || a.title.localeCompare(b.title))
    const byHall = new Map<string | null, WatchViewing[]>()
    for (const viewing of here) {
      const hall = viewing.seat == null ? null : (seatParts(viewing.seat)?.hall ?? null)
      byHall.set(hall, [...(byHall.get(hall) ?? []), viewing])
    }
    const halls = byHall.size === 1 && byHall.has(null) ? [] : [...byHall].map(([name, items]): HallVisits => ({ name, visits: items.length, works: newestFirst(items) }))
    return {
      kind: 'place',
      slug,
      name: place.name,
      owner: place.owner,
      city: place.city,
      country: place.country === null ? null : countryName(place.country),
      website: place.website,
      image: place.image ?? null,
      visits: here.length,
      first: dated[0]?.on ?? null,
      last: dated.at(-1)?.on ?? null,
      works: newestFirst(here),
      halls: halls.toSorted((a, b) => (a.name === null ? 1 : 0) - (b.name === null ? 1 : 0) || b.visits - a.visits || (a.name ?? '').localeCompare(b.name ?? '', 'nb', { numeric: true })),
    }
  }

  /** Every viewing of one item, newest first, as the item's page shows them. */
  const seenOf = (viewings: readonly WatchViewing[]): Seen[] =>
    [...datedOf(viewings).toReversed(), ...viewings.filter((viewing) => viewing.on === null)].map((viewing) => ({
      on: viewing.on,
      rating: viewing.rating,
      rewatch: viewing.rewatch,
      place: viewing.place === null ? null : { name: viewing.place.name, slug: placeSlug(viewing.place.name) },
      seat: viewing.seat ?? null,
      episode: viewing.episode,
    }))

  return {
    // The app's own words on top of the counts that speak every app's language the same way.
    datedOf,
    totalsOf,
    perYear,
    perMonth,
    perCalendarMonth,
    perWeekday,
    libraryOf,
    unseenOf,
    monthsOf,
    yearsOf,
    creditedOf,
    itemSlug,
    placeSlug,
    personSlug,
    listings,
    topRated,
    topLead,
    topActors,
    topGenres,
    topCountries,
    topLanguages,
    topDecades,
    topPlaces,
    entitiesOf,
    personPageOf,
    placePageOf,
    seenOf,
  }
}
