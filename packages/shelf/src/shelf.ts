/**
 * The counting of the shelf apps: a line of the log and the work the register matched it to become a `Work` (one per
 * title, however many lines it has), and a work is counted, listed and given a page of its own. Everything returned
 * here is published to anyone, so the owner's notes and the service's numbers never get this far (`ShelfLine`).
 */

import type * as v from 'valibot'

import type { BookFactRow, GameAchievementLine, GameCompanyRow, GameFacetRow, GameProfileRow, GameRomLine, GameTimeRow, ShelfLine } from '@designsystem/contracts/shelf-tables'
import { requestedChoice } from '@designsystem/intl/listening'
import { newestFirst as newestLibraryFirst, type LibraryStatus, type LibraryWork } from '@designsystem/ui/lib/library'
import { normalizeTitle, slugOf } from '@designsystem/intl/text'
import { isFromExport } from '@designsystem/ui/lib/entity-model'
import { ownershipOf, type CollectionLine, type Ownership } from '@designsystem/ui/lib/ownership'

import { bannerPathOf, coverPathOf, iconPathOf, iconSourceOf, logoPathOf } from './covers.ts'

/** A creator has gone quiet after three months with none of their work, once they had three lines. */

export type ShelfKind = 'game' | 'book' | 'boardgame'

export interface ShelfConfig {
  kind: ShelfKind
  /** The statuses a log line may have, the furthest along first: a work has the first of them that one of its lines has. A work with no line has `owned` or `want`, from the collection. */
  statuses: readonly string[]
  /** The statuses that count a work as done: finished, played. */
  done: readonly string[]
  /** What each status is in the library every app has: `playing` and `reading` are `doing`, `played` is `done`. */
  library: Readonly<Record<string, LibraryStatus>>
}

export type Line = v.InferOutput<typeof ShelfLine>

export type AchievementLine = v.InferOutput<typeof GameAchievementLine>

export type RomLine = v.InferOutput<typeof GameRomLine>
export type CompanyLine = v.InferOutput<typeof GameCompanyRow>
export type FacetLine = v.InferOutput<typeof GameFacetRow>
export type TimeLine = v.InferOutput<typeof GameTimeRow>
export type BookFactLine = v.InferOutput<typeof BookFactRow>
export type ProfileLine = v.InferOutput<typeof GameProfileRow>

/** Where the player stands at a service as one number: a level, a score, a rank; `history` is what it was on the earlier days read, oldest first, with today's last. */
export interface Reading {
  service: string
  key: string
  label: string
  value: number
  max: number | null
  history: { day: string; value: number }[]
}

/** The profile rows as readings: the newest day of each (service, key) is the value and the days up to it are the history. A number read once has no history to draw. */
export function readingsOf(rows: readonly ProfileLine[]): Reading[] {
  const byKey = new Map<string, ProfileLine[]>()
  for (const row of rows) byKey.set(`${row.source}/${row.key}`, [...(byKey.get(`${row.source}/${row.key}`) ?? []), row])
  return [...byKey.values()].flatMap((days) => {
    const sorted = days.toSorted((a, b) => a.day.localeCompare(b.day))
    const latest = sorted.at(-1)
    return latest === undefined ? [] : [{ service: latest.source, key: latest.key, label: latest.label, value: latest.value, max: latest.max, history: sorted.length < 2 ? [] : sorted.map((row) => ({ day: row.day, value: row.value })) }]
  })
}

/** An achievement as a page shows it: from Steam (`steam`), RetroAchievements (`ra`), Xbox (`xbox`), Game Center (`applegc`) or Pokémon GO (`pokemongo`), locked while `unlockedAt` is none and unlocked on an unknown day when it is 0. */
export interface Achievement {
  service: string
  title: string
  description: string | null
  /** The path the app serves the picture at (only for an unlocked one: a locked one's is not landed), and the address the script that lands it fetches from. */
  icon: string | null
  iconSource: string | null
  points: number | null
  rarity: number | null
  unlockedAt: number | null
  /** How far it is: the value counted towards `target`, the goal or the next tier's; and the tier of a medal that has tiers (1 bronze to 4 platinum) of `tiers`. */
  progress: number | null
  target: number | null
  tier: number | null
  tiers: number | null
}

export interface LogEntry {
  on: string | null
  status: string
  rating: number | null
  amount: number | null
  /** What the owner has of it on this line, or none. */
  format: string | null
}

/** A line of the collection: the owner has the work (`owned`) or wants it (`want`), with no line in the log needed. */
export interface Holding {
  status: string
  /** The day the line was added to the collection, or none. */
  on: string | null
  rating: number | null
  /** What the owner has of it: `cd`, `digital`, a platform. */
  format: string | null
}

export interface Work {
  key: string
  slug: string
  title: string
  year: number | null
  creator: string | null
  summary: string | null
  /** The path the app serves the cover at, and the address the script that lands it fetches from. */
  cover: string | null
  coverSource: string | null
  /** The wide picture for behind the page, in the same two forms. */
  banner: string | null
  bannerSource: string | null
  url: string | null
  genres: string[]
  /** The lines of the log: what was played or read. A work of the collection alone has none. */
  entries: LogEntry[]
  /** The lines of the collection. */
  holdings: Holding[]
  achievements: Achievement[]
  /** The ROM of this work in RomM (games only), or none. */
  rommId: number | null
  /** The path of the logo of each of its creators that has one, by name. */
  logos: Record<string, string>
  /** What IGDB says of a game: where it came out, how it is played, what it is about, its series (games only). */
  facets: Facets
  /** How long it takes in hours, quickly, at an ordinary pace and everything (games only), or none. */
  toBeat: ToBeat | null
  /** A book's usual page count and the country of its first author (books only). */
  pages: number | null
  authorCountry: string | null
}

/** A work as a list shows it. */
export interface Listing {
  slug: string
  title: string
  year: number | null
  creator: string | null
  cover: string | null
  status: string
  rating: number | null
  amount: number | null
  on: string | null
}

/** The platforms, modes, themes, perspectives and series a game has, by kind. */
export type Facets = Record<FacetKind, string[]>
export type FacetKind = FacetLine['kind']
export const noFacets = (): Facets => ({ platform: [], mode: [], theme: [], perspective: [], series: [] })

export interface ToBeat {
  hastily: number | null
  normally: number | null
  completely: number | null
}

export interface Group {
  name: string
  works: number
}

export interface Overview {
  totals: { works: number; done: number; rated: number; averageRating: number | null; amount: number; firstOn: string | null }
  /** Over every work: how many achievements there are, how many are unlocked and how many works have all of theirs. */
  achievements: { total: number; unlocked: number; completed: number }
  statuses: { status: string; works: number }[]
  years: { year: number; works: number }[]
  best: Listing[]
  creators: Group[]
  genres: Group[]
  decades: Group[]
  /** The platforms and themes of the games in the log (games only). */
  platforms: Group[]
  themes: Group[]
  /** Where the player stands at each service (games only). */
  profiles: Reading[]
  /** The countries of the authors of the books in the log (books only). */
  authorCountries: Group[]
  recent: Listing[]
}

export interface WorkPage {
  title: string
  year: number | null
  creator: string | null
  summary: string | null
  cover: string | null
  coverSource: string | null
  banner: string | null
  bannerSource: string | null
  url: string | null
  genres: string[]
  status: string
  rating: number | null
  /** Whether the owner has it, and in what form (`cd`, `digital`): the formats of every line, once each. */
  owned: boolean
  format: string | null
  /** The collection's lines for the work, or none where it has none. */
  collection: Ownership | null
  entries: LogEntry[]
  achievements: Achievement[]
  /** The number RomM has for this work's ROM, so the page can link to it. */
  rommId: number | null
  /** The path of the logo of each of its creators that has one, by name. */
  logos: Record<string, string>
  facets: Facets
  toBeat: ToBeat | null
  pages: number | null
  authorCountry: string | null
  /** Where the player stands at the services whose achievements the game has (games only). */
  profile: Reading[]
}

const BEST_KEPT = 5
const RECENT_KEPT = 20
const GROUPS_KEPT = 8

/** The key a line's work is known by: the register's number, or the title and year as the log writes them. */
function keyOf(line: Line): string {
  return line.item_id ?? `log:${normalizeTitle(line.title)}:${line.year ?? 0}`
}

const ROMAN = new Map([['II', '2'], ['III', '3'], ['IV', '4'], ['V', '5'], ['VI', '6'], ['VII', '7'], ['VIII', '8'], ['IX', '9'], ['X', '10']])

/** A title as games are compared by: «Baldur's Gate III» and «Baldur's Gate 3» are the same, as are «TEKKEN 7» and «Tekken 7». */
function comparableTitle(title: string): string {
  return normalizeTitle(title.replace(/\b[IVX]+\b/g, (numeral) => ROMAN.get(numeral) ?? numeral))
}

/** Release years differ by a few between the log, a platform's own and the register (a game's early access, a re-release): further apart is another game. */
const YEARS_APART = 5

/**
 * Gives every line the key of the first line that names the same game: the same title, as the log or the register writes it, and a year that is
 * not known to differ much. A line the register has not matched, or one it matched to a second entry of the same name, is then the same work as the matched one.
 */
function keysOf(lines: readonly Line[]): { keyFor: (line: Line) => string; headOf: (key: string) => Line | undefined } {
  const seen = new Map<string, { key: string; year: number }[]>()
  const heads = new Map<string, Line>()
  const keys = new Map<Line, string>()
  // Matched lines go first, so a line without a match joins theirs and not the other way round.
  const ordered = lines.toSorted((a, b) => Number(b.item_id !== null) - Number(a.item_id !== null))
  for (const line of ordered) {
    const names = [...new Set([line.title, line.item_title ?? line.title].map(comparableTitle))]
    const year = line.item_year ?? line.year ?? 0
    const same = names.flatMap((name) => seen.get(name) ?? []).find((other) => other.year === 0 || year === 0 || Math.abs(other.year - year) <= YEARS_APART)
    const key = same?.key ?? keyOf(line)
    if (same === undefined) heads.set(key, line)
    for (const name of names) seen.set(name, [...(seen.get(name) ?? []), { key, year }])
    keys.set(line, key)
  }
  return { keyFor: (line) => keys.get(line) ?? keyOf(line), headOf: (key) => heads.get(key) }
}

/** A picture is kept for an unlocked achievement only: the locked ones are many and show a lock. */
function iconOf(row: AchievementLine): Pick<Achievement, 'icon' | 'iconSource'> {
  const icon = row.unlocked_at === null ? null : iconPathOf(row.icon)
  return { icon, iconSource: icon === null || row.icon === null ? null : iconSourceOf(row.icon) }
}

/** The works of the log and the collection, in the order their first line comes (the log's first), each with the lines it has and what the register says. */
export function worksOf(lines: readonly Line[], genres: readonly { ext_id: string; genre: string }[], config: ShelfConfig, achievements: readonly AchievementLine[] = [], collection: readonly Line[] = [], roms: readonly RomLine[] = [], companies: readonly CompanyLine[] = [], extra: { facets: readonly FacetLine[]; times: readonly TimeLine[]; facts: readonly BookFactLine[] } = { facets: [], times: [], facts: [] }): Work[] {
  const logoOf = new Map(companies.flatMap((company) => { const path = logoPathOf(company.logo); return path === null ? [] : [[company.name, path] as const] }))
  const romOf = new Map(roms.map((rom) => [rom.item_id, rom.romm_id]))
  // A game with a log line has its achievements on the line; one only a ROM names has them on the work, by the register's number.
  const achievementsOf = new Map<number, Achievement[]>()
  const achievementsOfItem = new Map<string, Achievement[]>()
  for (const row of achievements) {
    const achievement: Achievement = { service: row.service, title: row.title, description: row.description, ...iconOf(row), points: row.points, rarity: row.rarity, unlockedAt: row.unlocked_at, progress: row.progress, target: row.target, tier: row.tier, tiers: row.tiers }
    if (row.entry_id !== null) achievementsOf.set(row.entry_id, [...(achievementsOf.get(row.entry_id) ?? []), achievement])
    else if (row.item_id !== null) achievementsOfItem.set(row.item_id, [...(achievementsOfItem.get(row.item_id) ?? []), achievement])
  }
  const facetsOf = new Map<string, Facets>()
  for (const row of extra.facets) {
    const facets = facetsOf.get(row.ext_id) ?? noFacets()
    facets[row.kind].push(row.name)
    facetsOf.set(row.ext_id, facets)
  }
  const timesOf = new Map(extra.times.map((row): [string, ToBeat] => [row.ext_id, { hastily: row.hastily_hours, normally: row.normally_hours, completely: row.completely_hours }]))
  const factsOf = new Map(extra.facts.map((row) => [row.ext_id, row]))
  const genresOf = new Map<string, string[]>()
  for (const row of genres) genresOf.set(row.ext_id, [...(genresOf.get(row.ext_id) ?? []), row.genre])
  const works = new Map<string, Work>()
  const { keyFor, headOf } = keysOf([...lines, ...collection])
  const workOf = (member: Line, key: string): Work => {
    const known = works.get(key)
    if (known !== undefined) return known
    const line = headOf(key) ?? member
    const work: Work = {
      key,
      slug: slugOf(`${config.kind}\u0000${key}`),
      title: line.item_title ?? line.title,
      year: line.item_year ?? line.year,
      creator: line.creator,
      summary: line.summary,
      cover: coverPathOf(line.cover),
      coverSource: coverPathOf(line.cover) === null ? null : line.cover,
      banner: bannerPathOf(line.banner),
      bannerSource: bannerPathOf(line.banner) === null ? null : line.banner,
      url: line.url,
      genres: line.item_id === null ? [] : (genresOf.get(line.item_id) ?? []),
      entries: [],
      holdings: [],
      achievements: [],
      rommId: line.item_id === null ? null : (romOf.get(line.item_id) ?? null),
      facets: line.item_id === null ? noFacets() : (facetsOf.get(line.item_id) ?? noFacets()),
      toBeat: line.item_id === null ? null : (timesOf.get(line.item_id) ?? null),
      pages: line.item_id === null ? null : (factsOf.get(line.item_id)?.pages ?? null),
      authorCountry: line.item_id === null ? null : (factsOf.get(line.item_id)?.author_country ?? null),
      logos: Object.fromEntries((line.creator?.split(', ') ?? []).flatMap((name) => { const path = logoOf.get(name); return path === undefined ? [] : [[name, path] as const] })),
    }
    works.set(key, work)
    return work
  }
  for (const line of lines) {
    const work = workOf(line, keyFor(line))
    work.entries.push({ on: line.on_date, status: line.status, rating: line.rating, amount: line.amount, format: line.format })
    work.achievements.push(...(achievementsOf.get(line.id) ?? []))
  }
  for (const line of collection) workOf(line, keyFor(line)).holdings.push({ status: line.status, on: line.on_date, rating: line.rating, format: line.format })
  for (const work of works.values()) work.achievements.push(...(achievementsOfItem.get(work.key) ?? []))
  return [...works.values()]
}

/** The works that have a line in the log: what the counting, the history and the work pages are made of. */
export function loggedOf(works: readonly Work[]): Work[] {
  return works.filter((work) => work.entries.length > 0)
}

/** The formats of every line of a work, in the log and in the collection, once each. */
function formatsOf(work: Work): string[] {
  const formats = [...work.entries.map((entry) => entry.format), ...work.holdings.map((holding) => holding.format)]
  return [...new Set(formats.flatMap((format) => (format === null ? [] : format.split(',').map((name) => name.trim()))))]
}

/** The furthest-along status any line of the work has; a work with none in the log is `owned`, else `want`. */
export function statusOf(work: Work, config: ShelfConfig): string {
  const logged = config.statuses.find((status) => work.entries.some((entry) => entry.status === status)) ?? work.entries[0]?.status
  return logged ?? (work.holdings.some((holding) => holding.status === 'owned') ? 'owned' : (work.holdings[0]?.status ?? ''))
}

/** The day of the work's latest dated line. */
function lastOn(work: Work): string | null {
  return work.entries.reduce<string | null>((latest, entry) => (entry.on !== null && (latest === null || entry.on > latest) ? entry.on : latest), null)
}

/** The rating of the work's last rated line: a game played again is rated by how it was the last time. A line of the collection rates a work not played. */
function ratingOf(work: Work): number | null {
  return work.entries.findLast((entry) => entry.rating !== null)?.rating ?? work.holdings.findLast((holding) => holding.rating !== null)?.rating ?? null
}

const amountOf = (work: Work): number | null => {
  const amounts = work.entries.flatMap((entry) => (entry.amount === null ? [] : [entry.amount]))
  return amounts.length === 0 ? null : amounts.reduce((sum, amount) => sum + amount, 0)
}

function listingOf(work: Work, config: ShelfConfig): Listing {
  return { slug: work.slug, title: work.title, year: work.year, creator: work.creator, cover: work.cover, status: statusOf(work, config), rating: ratingOf(work), amount: amountOf(work), on: lastOn(work) }
}

/** Newest day first, the works with no day last, and the title where the day is the same. */
function newestFirst(a: Listing, b: Listing): number {
  return (a.on === null ? 1 : 0) - (b.on === null ? 1 : 0) || (b.on ?? '').localeCompare(a.on ?? '') || a.title.localeCompare(b.title, 'nb')
}

/** The names a count is made of, the most first and the name where the count is the same. */
function ranked(names: readonly string[], kept = GROUPS_KEPT): Group[] {
  const counts = new Map<string, number>()
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
  return [...counts].map(([name, works]) => ({ name, works })).toSorted((a, b) => b.works - a.works || a.name.localeCompare(b.name, 'nb')).slice(0, kept)
}

export function overviewOf(works: readonly Work[], config: ShelfConfig, profiles: readonly Reading[] = []): Overview {
  const listings = works.map((work) => listingOf(work, config))
  const finished = new Set(works.filter((work) => config.done.includes(statusOf(work, config))).map((work) => work.slug))
  const rated = listings.filter((listing) => listing.rating !== null)
  const perYear = new Map<number, number>()
  for (const listing of listings) {
    if (listing.on === null || !finished.has(listing.slug)) continue
    const year = Number(listing.on.slice(0, 4))
    perYear.set(year, (perYear.get(year) ?? 0) + 1)
  }
  const days = listings.flatMap((listing) => (listing.on === null ? [] : [listing.on]))
  const counted = works.map((work) => work.achievements.filter((achievement) => !isFromExport(achievement))).filter((list) => list.length > 0)
  return {
    totals: {
      works: works.length,
      done: finished.size,
      rated: rated.length,
      averageRating: rated.length === 0 ? null : rated.reduce((sum, listing) => sum + (listing.rating ?? 0), 0) / rated.length,
      amount: listings.reduce((sum, listing) => sum + (listing.amount ?? 0), 0),
      firstOn: days.length === 0 ? null : days.reduce((first, day) => (day < first ? day : first)),
    },
    achievements: {
      total: counted.reduce((sum, list) => sum + list.length, 0),
      unlocked: counted.reduce((sum, list) => sum + list.filter((achievement) => achievement.unlockedAt !== null).length, 0),
      completed: counted.filter((list) => list.every((achievement) => achievement.unlockedAt !== null)).length,
    },
    statuses: config.statuses.map((status) => ({ status, works: listings.filter((listing) => listing.status === status).length })).filter((entry) => entry.works > 0),
    years: [...perYear].map(([year, count]) => ({ year, works: count })).toSorted((a, b) => a.year - b.year),
    best: rated.toSorted((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || newestFirst(a, b)).slice(0, BEST_KEPT),
    creators: ranked(works.flatMap((work) => (work.creator === null ? [] : work.creator.split(', ')))),
    genres: ranked(works.flatMap((work) => work.genres)),
    decades: ranked(works.flatMap((work) => (work.year === null ? [] : [`${Math.floor(work.year / 10) * 10}-tallet`]))).toSorted((a, b) => a.name.localeCompare(b.name)),
    profiles: [...profiles],
    platforms: ranked(works.flatMap((work) => work.facets.platform)),
    themes: ranked(works.flatMap((work) => work.facets.theme)),
    authorCountries: ranked(works.flatMap((work) => (work.authorCountry === null ? [] : [work.authorCountry]))),
    recent: listings.filter((listing) => listing.on !== null).toSorted(newestFirst).slice(0, RECENT_KEPT),
  }
}

/** Whether the owner has the work: a line of the collection says so, or a line of the log names what they have. */
function isOwned(work: Work): boolean {
  return work.holdings.some((holding) => holding.status === 'owned') || formatsOf(work).length > 0
}

/** Every work of the collection and the log as the library every app has: what it is, how the owner stands to it, how often and when it was played. */
export function libraryOf(works: readonly Work[], config: ShelfConfig): { works: LibraryWork[] } {
  const days = (work: Work) => work.entries.flatMap((entry) => (entry.on === null ? [] : [entry.on])).toSorted()
  const library = works.map((work): LibraryWork => {
    const listing = listingOf(work, config)
    return {
      kind: config.kind,
      slug: work.slug,
      title: work.title,
      creator: work.creator,
      year: work.year,
      cover: work.cover,
      status: config.library[listing.status] ?? 'done',
      owned: isOwned(work),
      format: formatsOf(work).join(', ') || null,
      rating: listing.rating,
      plays: work.entries.length,
      firstOn: days(work)[0] ?? null,
      lastOn: days(work).at(-1) ?? null,
      genres: work.genres,
    }
  })
  return { works: library.toSorted(newestLibraryFirst) }
}

/** One line of the log as the history shows it: the work it is about and what the line says. */
export interface HistoryEntry extends Omit<Listing, 'on'> {
  on: string | null
}

/** The years with a dated line, newest first. */
function yearsOf(works: readonly Work[]): string[] {
  const years = new Set(works.flatMap((work) => work.entries.flatMap((entry) => (entry.on === null ? [] : [entry.on.slice(0, 4)]))))
  return [...years].toSorted().toReversed()
}

/** The lines of one year (`year`, the newest without one), the newest day first; a line with no day is in the library only. */
export function historyOf(works: readonly Work[], year: string | null): { year: string; years: string[]; entries: HistoryEntry[] } {
  const years = yearsOf(works)
  const chosen = requestedChoice(year, years)
  const entries = works.flatMap((work) =>
    work.entries
      .filter((entry) => entry.on?.startsWith(chosen) === true)
      .map((entry): HistoryEntry => ({ slug: work.slug, title: work.title, year: work.year, creator: work.creator, cover: work.cover, status: entry.status, rating: entry.rating, amount: entry.amount, on: entry.on })),
  )
  return { year: chosen, years, entries: entries.toSorted(newestFirst) }
}

/** The page of one work, or none for a slug no work has. */
export function pageOf(works: readonly Work[], config: ShelfConfig, slug: string, profiles: readonly Reading[] = []): WorkPage | null {
  const work = works.find((candidate) => candidate.slug === slug)
  if (work === undefined) return null
  const { title, year, creator, summary, cover, coverSource, banner, bannerSource, url, genres, entries, achievements, rommId, logos, facets, toBeat, pages, authorCountry } = work
  const formats = formatsOf(work)
  const owned = isOwned(work)
  return { title, year, creator, summary, cover, coverSource, banner, bannerSource, url, genres, status: statusOf(work, config), rating: ratingOf(work), owned, collection: ownershipOf(work.holdings.map((holding): CollectionLine => ({ status: holding.status === 'owned' ? 'owned' : 'want', format: holding.format, addedOn: holding.on, rating: holding.rating }))), format: formats.length === 0 ? null : formats.join(', '), entries, achievements, rommId, logos, facets, toBeat, pages, authorCountry, profile: profiles.filter((reading) => achievements.some((achievement) => achievement.service === reading.service)) }
}
