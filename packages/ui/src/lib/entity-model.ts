/**
 * The page of one thing as DATA. An app turns what it has into an `EntityModel` (a pure function, testable with
 * `node --test`, no React) and `EntityView` decides how it looks: the hero, the rail, the order and the columns, the
 * formatting of every number. There is no ReactNode in the model and no way to ask for a class: a choice is data.
 */

import { formatClock, formatCount, formatDay, formatHoursAndMinutes, formatTimestampDay, formatTimes } from "@designsystem/intl/listening"

import { logSeries } from "./log-series.ts"
import { ownershipValue, type Ownership } from "./ownership.ts"

export type EntityKind = "film" | "tv" | "person" | "place" | "book" | "game" | "boardgame" | "show" | "episode" | "artist" | "album" | "song" | "collection" | "concert"

/** What each kind is called in the small heading of its page; a model's `kindLabel` replaces it where the app's word differs. */
export const KIND_LABEL: Readonly<Record<EntityKind, string>> = {
  film: "Film",
  tv: "Serie",
  person: "Person",
  place: "Sted",
  book: "Bok",
  game: "Spill",
  boardgame: "Brettspill",
  show: "Program",
  episode: "Episode",
  artist: "Artist",
  album: "Album",
  song: "Låt",
  collection: "Samling",
  concert: "Konsert",
}

/** A piece of text; with an address it is a link (a path of the app is its own page, `http…` is a link out), with `lang` it is marked as another language. */
export type Text = string | { readonly text: string; readonly href?: string; readonly lang?: string }
/** One text or a list of them, which reads «a, b, c». */
export type Value = Text | readonly Text[]
/** A label and its value; a fact whose value is none is left out. */
export type Fact = readonly [label: string, value: Value | null]

/** A figure the component writes: a count, a day, a length of time, a range with its unit, or text as it is. */
export type Num =
  | { readonly n: number }
  | { readonly times: number }
  | { readonly day: string }
  | { readonly ts: number }
  | { readonly at: number }
  | { readonly minutes: number }
  | { readonly range: readonly [number, number | null]; readonly unit: string }
  | { readonly words: string }

export interface Tile {
  label: string
  value: Num
  note?: string
  /** The page the value names, where it is one place (a link in the tile). */
  href?: string
}

export interface Row {
  name: Text
  picture?: string | null
  detail?: Text
  count?: Num | readonly Num[]
  muted?: boolean
  loved?: boolean
  /** What is said of the row at more length, in a popover from an «i» at its end; none, no button. */
  info?: readonly Fact[]
  /** Seen, said in words after the detail. */
  seen?: boolean
  /** The row of the page it is on: said in words, and not a link. */
  current?: boolean
}

/** The unit an app counts its log in: how a line's amount and the total are written. */
export type AmountUnit = "hours" | "pages" | "plays"

/** A game's achievement as the page shows it (`unlockedAt`: none is locked, 0 is unlocked on an unknown day). */
export interface AchievementData {
  service: string
  title: string
  description: string | null
  icon: string | null
  points: number | null
  rarity: number | null
  unlockedAt: number | null
  progress: number | null
  target: number | null
  tier: number | null
  tiers: number | null
}

/** One line of a work's log. */
export interface LogLine {
  on: string | null
  amount: number | null
}

interface RowsBody {
  kind: "rows"
  rows: readonly Row[]
  shape?: "poster" | "square"
}
interface ChartBody {
  kind: "chart"
  series: readonly { label: string; value: number }[]
  valueLabel: string
  ariaLabel?: string
  /** A column divided into parts (plays per year by album): one datum per label and series, the series bottom to top, a colour for each (none is a grey step). */
  stacked?: { data: readonly { label: string; series: string; value: number }[]; series: readonly string[]; colors?: readonly (string | null)[] }
  /** The colour of a chart of one thing, as CSS. */
  color?: string | null
  height?: number
  /** Label every nth column only, for a crowded axis (24 hours: every 3rd). */
  labelEvery?: number
}
/** A log along time, drawn as a chart where it spans three days or months or more; its counts are the page's tiles, so a shorter log has no section. */
interface LogBody {
  kind: "log"
  entries: readonly LogLine[]
  noun: { one: string; many: string }
  amount?: { label: string; unit: AmountUnit } | null
  /** Where the lines were, said under the chart. */
  where?: readonly Text[]
}
interface TableBody {
  kind: "table"
  head?: readonly string[]
  /** Which columns are figures; the first column is the name. */
  align?: readonly ("start" | "end")[]
  rows: readonly (readonly (Value | Num | null)[])[]
}
interface FactListBody {
  kind: "factlist"
  facts: readonly Fact[]
  lead?: Text
}
interface TextBody {
  kind: "text"
  lines: readonly (Text | Num)[]
}
/** Things as a gallery of pictures, each tile a link to its page (`href` none: not a link). */
interface GalleryBody {
  kind: "gallery"
  items: readonly { name: string; href: string | null; cover: string | null; ratio: "poster" | "square"; subtitle?: string | null }[]
}
/** Pictures and videos from an album, each a link to `href` (the album). */
interface PhotosBody {
  kind: "photos"
  photos: readonly { url: string; video: boolean }[]
  href: string
}
/** A map picture with the link to the full map and the credit its licence asks for. */
interface MapBody {
  kind: "map"
  src: string
  link: Text
  credit: Text
}
/** Lists of lines folded under a summary each; with fewer groups than `openBelow` they are shown open under their heading. */
interface FoldBody {
  kind: "fold"
  groups: readonly { summary: string; heading?: string; items: readonly string[] }[]
  /** Where the lines came from, as «Fra a, b». */
  source?: readonly Text[]
  openBelow?: number
  /** What the columns of an open list are called, for a screen reader: the line and its number. */
  head?: readonly [string, string]
}
interface AchievementsBody {
  kind: "achievements"
  achievements: readonly AchievementData[]
}

/**
 * Whose data a section is: `mine` is the owner's own (the log, a chart of plays, how it was seen, what was listened to), `about` is what the
 * thing itself holds (people, tracks, franchise, related, gallery). The view puts `mine` before `about`; a section that says nothing is
 * `mine` where it is a log, a chart or achievements and `about` otherwise (`bandOf`).
 */
export type Band = "mine" | "about"

export type Section = { id: string; title: string; note?: string; band?: Band } & (RowsBody | ChartBody | LogBody | TableBody | FactListBody | TextBody | AchievementsBody | GalleryBody | PhotosBody | MapBody | FoldBody)

export interface EntityModel {
  kind: EntityKind
  name: string
  /** `shape` is the shape of a cover that is not a banner: a box and a game are not alike. A cover with a shape stays whole beside the name, over its banner where it has one. */
  picture?: { cover?: string | null; banner?: string | null; shape?: "poster" | "square" }
  kindLabel?: string
  subtitle?: readonly Text[]
  facts?: readonly Fact[]
  paragraphs?: readonly { text: string; style?: "italic"; lang?: string }[]
  tiles?: readonly Tile[]
  rating?: { value: number; scale: 5 | 10; label?: string } | null
  ownership?: Ownership | null
  links?: readonly { label: string; href: string | null }[]
  mark?: { names: readonly string[]; logos: Readonly<Record<string, string>> }
  notice?: { kind: "credit"; name: string; href: string } | { kind: "tmdb" }
  sections: readonly Section[]
}

/** Which of the page's heads a model gets: the cover beside the name (over its banner), a wide picture over the name, or the name alone. */
export type Hero = { variant: "cover"; shape: "poster" | "square"; cover: string; banner: string | null } | { variant: "banner"; picture: string } | { variant: "name" }

export function heroOf(model: EntityModel): Hero {
  const cover = model.picture?.cover || null
  const banner = model.picture?.banner || null
  if (cover !== null && (banner === null || model.picture?.shape !== undefined)) return { variant: "cover", shape: model.picture?.shape ?? "poster", cover, banner }
  const picture = banner ?? cover
  return picture === null ? { variant: "name" } : { variant: "banner", picture }
}

export const kickerOf = (model: EntityModel): string => model.kindLabel ?? KIND_LABEL[model.kind]

export const isList = (value: Value): value is readonly Text[] => Array.isArray(value)
const textOf = (value: Text): string => (typeof value === "string" ? value : value.text)

/** The plain words of a value, for a label and for deciding whether there is anything to show. */
export const plainOf = (value: Value): string => (isList(value) ? value.map(textOf).join(", ") : textOf(value))

/** The facts that have something to say. */
export const visibleFacts = (facts: readonly Fact[] | undefined): (readonly [string, Value])[] => (facts ?? []).filter((fact): fact is readonly [string, Value] => fact[1] !== null && plainOf(fact[1]) !== "")

export const isNum = (cell: Value | Num): cell is Num => typeof cell === "object" && !Array.isArray(cell) && ("n" in cell || "times" in cell || "day" in cell || "ts" in cell || "at" in cell || "minutes" in cell || "range" in cell)

const dash = (low: number, high: number | null) => (high === null || high === low ? formatCount(low) : `${formatCount(low)}–${formatCount(high)}`)

/** A figure as the pages write it. */
export function formatNum(num: Num): string {
  if ("n" in num) return formatCount(num.n)
  if ("times" in num) return formatTimes(num.times)
  if ("day" in num) return formatDay(num.day)
  if ("ts" in num) return formatTimestampDay(num.ts)
  if ("at" in num) return formatClock(num.at)
  if ("minutes" in num) return formatHoursAndMinutes(num.minutes)
  if ("range" in num) return `${dash(num.range[0], num.range[1])} ${num.unit}`
  return num.words
}

/** How an app's amount is written, a total or a line of the log. */
export function formatAmount(unit: AmountUnit, amount: number): string {
  if (unit === "pages") return `${formatCount(Math.round(amount))} s`
  if (unit === "plays") return `${formatCount(Math.round(amount))} ${Math.round(amount) === 1 ? "parti" : "partier"}`
  return amount < 1 ? `${formatCount(Math.max(1, Math.round(amount * 60)))} min` : `${formatCount(Math.round(amount))} t`
}

/** A rating on its scale as stars out of five (a half star where it falls), and the exact value for a screen reader and `label` for what it was rated on. */
export function starsOf(rating: NonNullable<EntityModel["rating"]>): { stars: number; label: string } {
  const exact = formatCount(rating.value)
  const stars = rating.scale === 5 ? rating.value : rating.value / 2
  return { stars, label: `${rating.label ?? "Vurdering"} ${exact} av ${rating.scale}` }
}

/** The groups of a fold that have lines. */
export const foldGroups = <Group extends { items: readonly string[] }>(section: { groups: readonly Group[] }): Group[] => section.groups.filter((group) => group.items.length > 0)

/** A fold shows open (each group under its heading) while it has fewer groups than `openBelow`; else every group is folded. */
export const foldIsOpen = (section: { groups: readonly unknown[]; openBelow?: number }): boolean => section.groups.length < (section.openBelow ?? 0)

/** The row's facts for its «i» popover, or none where nothing is known. */
export const rowInfo = (row: Row): (readonly [string, Value])[] => visibleFacts(row.info)

/** The sections that have something to show; a log only where it is a chart (a shorter one is said by the tiles). */
export function visibleSections(sections: readonly Section[]): Section[] {
  return sections.filter((section) => {
    switch (section.kind) {
      case "log":
        return logSeries(section.entries).labels.length >= 3
      case "chart":
        return section.series.some((point) => point.value > 0) || (section.stacked?.data.some((point) => point.value > 0) ?? false)
      case "gallery":
        return section.items.length > 0
      case "photos":
        return section.photos.length > 0
      case "map":
        return section.src !== ""
      case "fold":
        return foldGroups(section).length > 0
      case "factlist":
        return visibleFacts(section.facts).length > 0
      case "text":
        return section.lines.length > 0
      case "rows":
      case "table":
        return section.rows.length > 0
      case "achievements":
        return section.achievements.length > 0
    }
  })
}

/** Which band a section is in: what it says, else what its kind implies (the owner's own data are the log, the charts and the achievements). */
export const bandOf = (section: Section): Band => section.band ?? (section.kind === "log" || section.kind === "chart" || section.kind === "achievements" ? "mine" : "about")

/**
 * The sections of the page's main column in the one order every kind has: what has something to show, the owner's own first
 * (`mine`), then what the thing holds (`about`), each in the order the model gave. A map is not here: it stands in the rail.
 */
export function mainSections(sections: readonly Section[]): Section[] {
  const shown = visibleSections(sections).filter((section) => section.kind !== "map")
  return [...shown.filter((section) => bandOf(section) === "mine"), ...shown.filter((section) => bandOf(section) === "about")]
}

/** The maps of a page, which stand in the rail over what is said of the thing. */
export const mapSections = (sections: readonly Section[]): Section[] => visibleSections(sections).filter((section) => section.kind === "map")

/** The numbers of a page, in the one row under its head: what the model counts, then what the owner has of it (`Eier`). */
export function tilesOf(model: Pick<EntityModel, "tiles" | "ownership">): Tile[] {
  return [...(model.tiles ?? []), ...(model.ownership == null ? [] : [{ label: "Eier", value: { words: ownershipValue(model.ownership) } }])]
}

/** The longest a factlist or text may be to stand beside another one, and the most their lengths may differ: then the two have nearly the same height. */
export const PAIR_MAX = 8
export const PAIR_SPREAD = 2

const shortLength = (section: Section): number | null => {
  if (section.kind === "factlist") return visibleFacts(section.facts).length
  if (section.kind === "text") return section.lines.length
  return null
}

/**
 * The main column's sections grouped for the page: two consecutive short facts or text sections of the same band (at most `PAIR_MAX` lines
 * each, and no more than `PAIR_SPREAD` apart) are a pair, drawn in two equal columns; every other section is alone, full width.
 */
export function mainBlocks(sections: readonly Section[]): Section[][] {
  const blocks: Section[][] = []
  for (let index = 0; index < sections.length; index++) {
    const section = sections[index]
    const next = sections[index + 1]
    if (section === undefined) continue
    const length = shortLength(section)
    const other = next === undefined ? null : shortLength(next)
    if (next !== undefined && length !== null && other !== null && length <= PAIR_MAX && other <= PAIR_MAX && Math.abs(length - other) <= PAIR_SPREAD && bandOf(section) === bandOf(next)) {
      blocks.push([section, next])
      index++
    } else blocks.push([section])
  }
  return blocks
}

/** Whether the rail of a page has anything to hold; its kind alone is no reason for one. A cover head already holds the facts. */
export const hasRail = (model: EntityModel): boolean =>
  (heroOf(model).variant !== "cover" && visibleFacts(model.facts).length > 0) ||
  (model.subtitle?.length ?? 0) > 0 ||
  (model.paragraphs?.length ?? 0) > 0 ||
  (model.links ?? []).some((link) => link.href !== null && link.href !== "") ||
  model.mark !== undefined ||
  (model.rating ?? null) !== null ||
  mapSections(model.sections).length > 0

/** The names the services of the achievements go by. */
export const SERVICES: Readonly<Record<string, string>> = { steam: "Steam", ra: "RetroAchievements", xbox: "Xbox", pokemongo: "Pokémon GO" }

/** An Xbox achievement with no rarity comes from a list of only the unlocked (TrueAchievements' export, an Xbox 360 game), and a Game Center one (`applegc`) from Apple's export of the ones with any progress: neither has a total, so the counts leave them out. */
export const isFromExport = (achievement: Pick<AchievementData, "service" | "rarity">): boolean => (achievement.service === "xbox" && achievement.rarity === null) || achievement.service === "applegc"
