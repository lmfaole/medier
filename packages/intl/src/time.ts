/**
 * The one place a time or a day is turned into text. Every page writes a time through `formatTime` (or the `Time` component of
 * `packages/ui`, which wraps it in a `<time>` element): Norwegian, in Oslo, so the server and the browser write the same first render
 * and no page shows a raw `2026-11-11T06:55:04.667Z`. `scripts/time-format.test.ts` fails on `Intl.DateTimeFormat`, `toLocale…String`
 * and the like anywhere else; its `ALLOWED` list is what was left when the rule came, and it only shrinks.
 *
 * A value is an ISO time, a `Date` or epoch milliseconds, shown in Oslo; or a plain day (`2026-11-05`), which is a calendar day that
 * no time zone moves and has no clock (a style with a clock falls back to its date).
 *
 *   datetime    «11. november 2026 kl. 07:55» (default)    compact   «11. nov. 2026, 07:55» (the end of a line under a title)
 *   date        «11. november 2026»                        day       «5. nov.»
 *   month       «november 2026»                            year      «2026»
 *   weekday     «onsdag»                                   weekdayDate  «onsdag 11. november 2026»
 *   clock       «07:55»
 */

import { formatDate } from "./date.ts"

export type TimeStyle = "datetime" | "compact" | "date" | "day" | "month" | "year" | "weekday" | "weekdayDate" | "clock"
export type TimeValue = string | number | Date

const OSLO = "Europe/Oslo"
const STYLES: Record<TimeStyle, Intl.DateTimeFormatOptions> = {
  datetime: { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
  compact: { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
  date: { day: "numeric", month: "long", year: "numeric" },
  day: { day: "numeric", month: "short" },
  month: { month: "long", year: "numeric" },
  year: { year: "numeric" },
  weekday: { weekday: "long" },
  weekdayDate: { weekday: "long", day: "numeric", month: "long", year: "numeric" },
  clock: { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
}
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** Written when the value is no time at all: a page shows this rather than a raw string or «Invalid Date». */
export const UNKNOWN_TIME = "ukjent tid"

const isPlainDay = (value: TimeValue): value is string => typeof value === "string" && DAY.test(value)

/** The moment a value is, or `null`. A plain day is its midnight in UTC. */
function moment(value: TimeValue | null | undefined): Date | null {
  if (!(value instanceof Date) && typeof value !== "string" && typeof value !== "number") return null
  const date = value instanceof Date ? value : new Date(isPlainDay(value) ? `${value}T00:00:00Z` : value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** The time as text in the style; «ukjent tid» for what is no time. */
export function formatTime(value: TimeValue | null | undefined, style: TimeStyle = "datetime"): string {
  const date = moment(value)
  if (date === null) return UNKNOWN_TIME
  const plainDay = typeof value === "string" && isPlainDay(value)
  const effective: TimeStyle = plainDay && "hour" in STYLES[style] ? "date" : style
  return formatDate(date, "nb-NO", { ...STYLES[effective], timeZone: plainDay ? "UTC" : OSLO })
}

/** The machine-readable form for a `<time datetime>`: the day for a plain day, else the ISO time; `null` for what is no time. */
export function timeStamp(value: TimeValue | null | undefined): string | null {
  const date = moment(value)
  if (date === null) return null
  return typeof value === "string" && isPlainDay(value) ? value : date.toISOString()
}

/** The calendar day (`2026-11-11`) a moment falls on in Oslo: what a day is grouped or compared by. */
export function osloDay(value: TimeValue): string {
  const date = moment(value)
  if (date === null) throw new RangeError(`not a time: ${String(value)}`)
  return formatDate(date, "sv-SE", { timeZone: OSLO })
}

const SINCE_UNITS = [
  { unit: "day", seconds: 86_400 },
  { unit: "hour", seconds: 3_600 },
  { unit: "minute", seconds: 60 },
] as const satisfies readonly { unit: Intl.RelativeTimeFormatUnit; seconds: number }[]
const SINCE_WORDS = new Intl.RelativeTimeFormat("nb-NO", { numeric: "auto" })

/** How long ago, in words: «for 3 timer siden», «i går»; a moment ago, or an instant ahead of `now`, is «nå». */
export function formatSince(value: TimeValue | null | undefined, now: Date): string {
  const date = moment(value)
  if (date === null) return UNKNOWN_TIME
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)
  const found = SINCE_UNITS.find(({ seconds: size }) => seconds >= size)
  return found === undefined ? "nå" : SINCE_WORDS.format(-Math.floor(seconds / found.seconds), found.unit)
}

/** The ISO 8601 week of a day (`YYYY-MM-DD`, the Monday a week starts): its number, and the year the week belongs to (the year of its Thursday). */
export function isoWeek(day: string): { week: number; year: number } {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + 3)
  const year = date.getUTCFullYear()
  const januaryFourth = new Date(Date.UTC(year, 0, 4))
  const week = 1 + Math.round(((date.getTime() - januaryFourth.getTime()) / 86_400_000 - 3 + ((januaryFourth.getUTCDay() + 6) % 7)) / 7)
  return { week, year }
}
