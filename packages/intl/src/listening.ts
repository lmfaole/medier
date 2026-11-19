// How a listening history reads in Norwegian: counts, durations and the names of the periods a chart can cover.
// Shared by the apps that show one (music, podkast).

import { formatDate } from './date.ts'
import { formatNumber } from './number.ts'

export function formatCount(count: number): string {
  return formatNumber(count, 'nb-NO')
}

/** «all» → «Totalt», «last-30-days» → «Siste 30 dager», a year as it is. */
export function formatPeriodLabel(period: string): string {
  if (period === 'all') return 'Totalt'
  const rollingDays = /^last-(\d+)-days$/.exec(period)
  if (rollingDays) return `Siste ${rollingDays[1]} dager`
  return period
}

/** 165 → «2 t 45 min», 45 → «45 min», 120 → «2 t»: how every app writes a length of time. */
export function formatHoursAndMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest} min`
  return rest === 0 ? `${formatNumber(hours, 'nb-NO')} t` : `${formatNumber(hours, 'nb-NO')} t ${rest} min`
}

/** 7380 minutes → «123 t»: whole hours, for a total too long to read in minutes. */
export function formatWholeHours(minutes: number): string {
  return `${formatNumber(Math.round(minutes / 60), 'nb-NO')} t`
}

/** 3723 → «1 t 2 min», 750 → «12 min», 45 → «45 s»: a length given in seconds. */
export function formatSeconds(seconds: number): string {
  return seconds < 60 ? `${seconds} s` : formatHoursAndMinutes(Math.floor(seconds / 60))
}

/** 12 → «12×», 1686 → «1 686×»: how often something happened. */
export function formatTimes(count: number): string {
  return `${formatCount(count)}×`
}

/** `YYYY-MM`, a month. */
export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

/** `YYYY`, a year. */
export const YEAR = /^\d{4}$/

/** «2025-03» → «mar. 2025». */
export function formatMonthLabel(month: string): string {
  return formatDate(`${month}-01T00:00:00Z`, 'nb-NO', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** One count per year from the first of `years` to the last, a year with none being 0, so a year without a play is a column of zero. */
export function playsPerYear(years: readonly number[]): { year: number; plays: number }[] {
  if (years.length === 0) return []
  const counts = new Map<number, number>()
  for (const year of years) counts.set(year, (counts.get(year) ?? 0) + 1)
  const first = Math.min(...years)
  return Array.from({ length: Math.max(...years) - first + 1 }, (_, index) => ({ year: first + index, plays: counts.get(first + index) ?? 0 }))
}

/** The most days in a row among `days` (`YYYY-MM-DD`, any order, any repeats); 0 for none. */
export function longestRun(days: readonly string[]): number {
  let best = 0
  let run = 0
  let previous: number | null = null
  for (const day of [...new Set(days)].toSorted()) {
    const at = Date.parse(`${day}T00:00:00Z`) / 86_400_000
    run = previous !== null && at - previous === 1 ? run + 1 : 1
    best = Math.max(best, run)
    previous = at
  }
  return best
}

/** «2025-08-02» → «2. august 2025». */
export function formatDay(day: string): string {
  return formatDate(`${day}T00:00:00Z`, 'nb-NO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** «2025-08-02» → «2. aug. 2025»: a day in a list or a table, where the long form is too wide. */
export function formatShortDay(day: string): string {
  return formatDate(`${day}T00:00:00Z`, 'nb-NO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** Unix seconds as «2. aug. 2025», the day in UTC like the sync's days. */
export function formatTimestampDay(seconds: number): string {
  return formatShortDay(new Date(seconds * 1000).toISOString().slice(0, 10))
}

/**
 * Unix seconds as «6. apr. 2018, 14:05», in Oslo time. A fixed time of day, not «3 hours ago»: it is the same on the server
 * and in the browser, the same for a reader without JavaScript and it never goes stale while a page is open.
 */
export function formatClock(seconds: number): string {
  return formatDate(new Date(seconds * 1000), 'nb-NO', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' })
}

/** «2025-03» → «mars 2025»: a month in a heading or a sentence; `formatMonthLabel` is the short form for a select or a chart. */
export function formatMonth(month: string): string {
  return formatDate(`${month}-01T00:00:00Z`, 'nb-NO', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** «en» → «engelsk»; a code the platform does not know is shown as it is. */
export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(['nb'], { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}

/** «NO» → «Norge»; a code the platform does not know is shown as it is. */
export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['nb'], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}

/** The choice a request names among `allowed`, else the first of them, else nothing. */
export function requestedChoice(asked: string | null, allowed: readonly string[]): string {
  return asked !== null && allowed.includes(asked) ? asked : (allowed[0] ?? '')
}

export const MONTH_NAMES = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"] as const
export const WEEKDAY_NAMES = ["mandager", "tirsdager", "onsdager", "torsdager", "fredager", "lørdager", "søndager"] as const

/** The place of the biggest of some counts (the first on a tie), for «the month you most…». */
export function peakIndex(counts: readonly number[]): number {
  return counts.indexOf(Math.max(...counts))
}
