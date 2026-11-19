/**
 * The API of a watch-log app, the same for every one of them: files built at snapshot time, by loaders that read
 * the viewings out of the app's own database. Everything here is published to anyone.
 *
 * The app supplies how its viewings and its people are read and how the page of one item is built; the rest — the
 * overview, the day, the month, the year and the page of a person or a place — is counted
 * by `@designsystem/watch/viewing` and handed back as JSON.
 */

import { requestedChoice } from '@designsystem/intl/listening'

import { ownershipOf, type Ownership } from '@designsystem/ui/lib/ownership'

import { franchiseOfWork, NO_EXTRAS, relatedWorks, type Known, type WatchExtras } from './extras.ts'
import { creditsOf, itemKey, posterUrl, watchCore, type FranchiseShelf, type Person, type PersonInfo, type PlannedVisit, type RelatedWork, type WatchCollectionLine, type WatchConfig, type WatchItem, type WatchViewing } from './viewing.ts'

/** What an item page carries that the API sets and a page builder leaves empty. */
interface ApiSet {
  ownership: Ownership | null
  related: RelatedWork[]
  franchise: FranchiseShelf | null
}

/** What the owner has by the register's number: the page of every viewing and collection line, and the numbers seen. */
export function knownOf<Item extends WatchItem>(itemSlug: (key: string) => string, viewings: readonly WatchViewing<Item>[], collection: readonly WatchCollectionLine<Item>[]): Known {
  const slugs = new Map<number, string>()
  const seen = new Set<number>()
  for (const line of collection) {
    const id = line.item?.tmdbId ?? line.tmdbId
    if (id !== null) slugs.set(id, itemSlug(itemKey(line)))
  }
  for (const viewing of viewings) {
    const id = viewing.item?.tmdbId ?? viewing.tmdbId
    if (id === null) continue
    slugs.set(id, itemSlug(itemKey(viewing)))
    // A viewing with no known day still counts as a work seen.
    seen.add(id)
  }
  return { slugs, seen }
}

interface Lookup<Item extends WatchItem> {
  known: Known
  keys: Map<string, string>
  people: Map<string, Person>
  unseen: Map<string, WatchCollectionLine<Item>>
}

const NO_LINES: readonly never[] = []

export interface WatchApiOptions<Item extends WatchItem, ItemPage extends ApiSet> {
  /** The viewings of one database, read once per snapshot by the app's own cache. */
  viewingsOf: (db: D1Database) => Promise<WatchViewing<Item>[]>
  personInfoOf: (db: D1Database) => Promise<Map<number, PersonInfo>>
  /** The page of one item, or `null` for a key no viewing has. */
  itemPageOf: (viewings: readonly WatchViewing<Item>[], key: string) => ItemPage | null
  /** What the owner has or wants, with the register's answer for each line; none for an app without a collection. */
  collectionOf?: (db: D1Database) => Promise<WatchCollectionLine<Item>[]>
  /** What the register recommends and the franchises, read once per database; none for an app without them. */
  extrasOf?: (db: D1Database) => Promise<WatchExtras>
  /** The visits the calendar has planned from today on; none for an app without one. */
  plannedOf?: (db: D1Database) => Promise<PlannedVisit[]>
  recentLimit?: number
}

const OSLO_NOW = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })

/** Oslo's today as `YYYY-MM-DD` and its clock as `HH:MM`. */
export function osloNow(now: Date = new Date()): { day: string; time: string } {
  const parts = Object.fromEntries(OSLO_NOW.formatToParts(now).map((part) => [part.type, part.value]))
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

export function watchApi<ItemKind extends string, PlaceKind extends string, Item extends WatchItem, ItemPage extends ApiSet>(config: WatchConfig<ItemKind, PlaceKind>, { viewingsOf, personInfoOf, itemPageOf, collectionOf, extrasOf, plannedOf, recentLimit = 20 }: WatchApiOptions<Item, ItemPage>) {
  const core = watchCore(config)

  async function overview(db: D1Database) {
    const viewings = await viewingsOf(db)
    const planned = plannedOf === undefined ? [] : await plannedOf(db)
    // A visit logged ahead of its day (a ticket mail) is the one the calendar plans: one line, with its time and cinema.
    const visitOf = (viewing: { on: string; title: string }) => planned.find((visit) => visit.on === viewing.on && visit.title.toLowerCase() === viewing.title.toLowerCase())
    // What is still to come (a ticket mail, a planned visit later today) is not a latest viewing: a day only is there from its day.
    const { day: today, time: now } = osloNow()
    const dated = core.datedOf(viewings).filter((viewing) => viewing.on < today || (viewing.on === today && (visitOf(viewing)?.at ?? '00:00') <= now))
    return {
      totals: core.totalsOf(viewings),
      years: core.perYear(viewings),
      best: core.topRated(viewings, 5),
      lead: core.topLead(viewings, 5),
      recent: dated.slice(-recentLimit).toReversed().map((viewing) => ({
        on: viewing.on,
        title: viewing.item?.title ?? viewing.title,
        year: viewing.item?.year ?? viewing.year,
        rating: viewing.rating,
        slug: core.itemSlug(itemKey(viewing)),
        poster: posterUrl(viewing.item),
        at: visitOf(viewing)?.at ?? null,
        cinema: visitOf(viewing)?.cinema ?? (config.placeKind === 'cinema' ? (viewing.place?.name ?? null) : null),
        episode: viewing.episode,
      })),
      planned: planned.filter((visit) => !dated.some((viewing) => visitOf(viewing) === visit)),
      months: core.perCalendarMonth(viewings),
      weekdays: core.perWeekday(viewings),
      actors: core.topActors(viewings, 8),
      genres: core.topGenres(viewings, 8),
      countries: core.topCountries(viewings, 8),
      languages: core.topLanguages(viewings, 8),
      decades: core.topDecades(viewings, 8),
      places: core.topPlaces(viewings, 8),
    }
  }

  /** Every viewing of one year (`?year=`, the newest without one), the newest day first; a viewing with no day is in the library only. */
  async function history(db: D1Database, url: URL) {
    const viewings = await viewingsOf(db)
    const years = core.yearsOf(viewings)
    const year = requestedChoice(url.searchParams.get('year'), years)
    const rows = core.datedOf(viewings)
      .filter((viewing) => viewing.on.startsWith(year))
      .map((viewing) => ({
        on: viewing.on,
        slug: core.itemSlug(itemKey(viewing)),
        title: viewing.item?.title ?? viewing.title,
        year: viewing.item?.year ?? viewing.year,
        rating: viewing.rating,
        rewatch: viewing.rewatch,
        episode: viewing.episode,
        place: viewing.place?.name ?? null,
        cover: posterUrl(viewing.item),
        creator: creditsOf(viewing.item, config.leadJob).map((credit) => credit.name).join(', ') || null,
      }))
    return { year, years, plays: rows.toSorted((a, b) => b.on.localeCompare(a.on)) }
  }

  /** Every item seen once, for the library page's search and filters. */
  async function library(db: D1Database) {
    return core.libraryOf(await viewingsOf(db), collectionOf === undefined ? [] : await collectionOf(db))
  }

  /**
   * The page of a work the owner has or wants and has not seen: built as the app builds any page, from a stand-in viewing
   * that is then taken out again, and with no people, whose pages are made from what was seen.
   */
  function unseenPage(line: WatchCollectionLine<Item>, collection: readonly WatchCollectionLine<Item>[], beside: (tmdbId: number | null) => Pick<ItemPage, 'related' | 'franchise'>) {
    const key = itemKey(line)
    const standIn: WatchViewing<Item> = { id: -1, on: null, title: line.title, year: line.year, rating: null, rewatch: false, tmdbId: line.tmdbId, item: line.item, place: null, episode: null }
    const page = itemPageOf([standIn], key)
    return page === null ? null : { ...page, seen: core.seenOf([]), lead: [], cast: [], crew: [], ownership: ownershipOf(collection.filter((other) => itemKey(other) === key)), ...beside(line.item?.tmdbId ?? line.tmdbId) }
  }

  /**
   * What `entity` looks up by slug, built once per (viewings, collection) pair: the snapshot asks for every page of the same
   * log, and finding one by slugging every key again made the snapshot of a big log take half a minute. The arrays are read-only
   * after they are loaded, and each lookup keeps the first match, as `find` did.
   */
  const lookups = new WeakMap<readonly WatchViewing<Item>[], WeakMap<readonly WatchCollectionLine<Item>[], Lookup<Item>>>()
  function lookupOf(viewings: readonly WatchViewing<Item>[], collection: readonly WatchCollectionLine<Item>[]): Lookup<Item> {
    const byCollection = lookups.get(viewings) ?? new WeakMap<readonly WatchCollectionLine<Item>[], Lookup<Item>>()
    lookups.set(viewings, byCollection)
    const cached = byCollection.get(collection)
    if (cached !== undefined) return cached
    const keys = new Map<string, string>()
    for (const viewing of viewings) {
      const key = itemKey(viewing)
      const slug = core.itemSlug(key)
      if (!keys.has(slug)) keys.set(slug, key)
    }
    const people = new Map<string, Person>()
    for (const viewing of viewings) {
      for (const person of core.creditedOf(viewing.item)) {
        const slug = core.personSlug(person)
        if (!people.has(slug)) people.set(slug, person)
      }
    }
    const unseen = new Map<string, WatchCollectionLine<Item>>()
    for (const line of core.unseenOf(viewings, collection)) {
      const slug = core.itemSlug(itemKey(line))
      if (!unseen.has(slug)) unseen.set(slug, line)
    }
    const built = { known: knownOf(core.itemSlug, viewings, collection), keys, people, unseen }
    byCollection.set(collection, built)
    return built
  }

  /** One page: an item or a person by its slug, or `null` (a 404) for a slug there is none of. */
  async function entity(db: D1Database, url: URL) {
    const kind = url.searchParams.get('kind')
    const slug = url.searchParams.get('slug')
    const viewings = await viewingsOf(db)
    if (kind === config.itemKind) {
      const collection = collectionOf === undefined ? [] : await collectionOf(db)
      const extras = extrasOf === undefined ? NO_EXTRAS : await extrasOf(db)
      const { known, keys, unseen: unseenBySlug } = lookupOf(viewings, collection)
      const beside = (tmdbId: number | null): Pick<ItemPage, 'related' | 'franchise'> => (tmdbId === null ? { related: [], franchise: null } : { related: relatedWorks(tmdbId, extras, known), franchise: franchiseOfWork(tmdbId, extras, known) })
      const unseen = slug === null ? undefined : unseenBySlug.get(slug)
      if (unseen !== undefined) return unseenPage(unseen, collection, beside)
      const key = slug === null ? undefined : keys.get(slug)
      const page = key === undefined ? null : itemPageOf(viewings, key)
      if (key === undefined || page === null) return page
      const latest = viewings.findLast((viewing) => itemKey(viewing) === key)
      const owned = collectionOf === undefined ? {} : { ownership: ownershipOf(collection.filter((line) => itemKey(line) === key)) }
      return { ...page, ...owned, ...beside(latest?.item?.tmdbId ?? latest?.tmdbId ?? null) }
    }
    if (kind === config.placeKind) return core.placePageOf(viewings, slug ?? '')
    if (kind !== 'person') return null
    const person = lookupOf(viewings, collectionOf === undefined ? NO_LINES : await collectionOf(db)).people.get(slug ?? '')
    return person === undefined ? null : core.personPageOf(viewings, person.id, (await personInfoOf(db)).get(person.id))
  }

  return { overview, history, library, entity }
}
