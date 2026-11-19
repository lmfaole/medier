/**
 * A work's log as one series along time, for the charts of its page: a bucket for each day (a log that spans two months
 * or less) or each month between the first and the last dated line, the empty ones too, so the gaps show. A line with
 * no day is not on the axis and is counted apart.
 */

/** What a series needs of a line of a log: the day it falls on, or none, and an amount (hours, pages), or none. */
export interface SeriesEntry {
  on: string | null
  amount?: number | null | undefined
}

/** A log spanning no more than this many days is drawn by the day. */
const DAILY_UP_TO = 62

export interface LogSeries {
  unit: 'day' | 'month'
  /** `YYYY-MM-DD` or `YYYY-MM`, first to last. */
  labels: string[]
  lines: number[]
  amounts: number[]
  first: string | null
  last: string | null
  undated: number
}

const dayNumber = (day: string): number => Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000)
const dayOf = (number: number): string => new Date(number * 86_400_000).toISOString().slice(0, 10)

/** The month after `month` (`YYYY-MM`). */
function nextMonth(month: string): string {
  const [year = 0, number = 1] = month.split('-').map(Number)
  return number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, '0')}`
}

export function logSeries(entries: readonly SeriesEntry[]): LogSeries {
  const dated = entries.flatMap((entry) => (entry.on === null ? [] : [{ on: entry.on, amount: entry.amount ?? 0 }]))
  const undated = entries.length - dated.length
  const days = dated.map((entry) => entry.on).toSorted()
  const first = days[0] ?? null
  const last = days.at(-1) ?? null
  if (first === null || last === null) return { unit: 'day', labels: [], lines: [], amounts: [], first, last, undated }
  const unit = dayNumber(last) - dayNumber(first) <= DAILY_UP_TO ? 'day' : 'month'
  const span = (day: string) => (unit === 'day' ? day : day.slice(0, 7))
  const labels: string[] = []
  if (unit === 'day') {
    for (let day = dayNumber(first); day <= dayNumber(last); day++) labels.push(dayOf(day))
  } else {
    for (let month = span(first); month <= span(last); month = nextMonth(month)) labels.push(month)
  }
  const lines = labels.map(() => 0)
  const amounts = labels.map(() => 0)
  for (const entry of dated) {
    const index = labels.indexOf(span(entry.on))
    lines[index] = (lines[index] ?? 0) + 1
    amounts[index] = (amounts[index] ?? 0) + entry.amount
  }
  return { unit, labels, lines, amounts, first, last, undated }
}

/** The most days the rhythm calendar shows: a year, 53 columns. */
export const CALENDAR_DAYS = 365

/** A day with a row for every day of the last year of the log (the latest dated line backwards), a day with no line being 0: for the calendar, where an empty day is part of the picture. */
export function calendarDays(entries: readonly SeriesEntry[]): { date: string; value: number }[] {
  const days = entries.flatMap((entry) => (entry.on === null ? [] : [entry.on])).toSorted()
  const last = days.at(-1)
  if (last === undefined) return []
  const end = dayNumber(last)
  const counts = new Map<string, number>()
  for (const day of days) counts.set(day, (counts.get(day) ?? 0) + 1)
  const start = Math.max(dayNumber(days[0] ?? last), end - CALENDAR_DAYS + 1)
  return Array.from({ length: end - start + 1 }, (_, index) => {
    const date = dayOf(start + index)
    return { date, value: counts.get(date) ?? 0 }
  })
}
