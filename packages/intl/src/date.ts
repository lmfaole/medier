/**
 * Date formatting shared by `cv`, `budget` and `music`, each of which had
 * its own hand-rolled version — one split an ISO string with `.split("-")`,
 * another built the same string by hand from a month-name array. Both are
 * exactly what `Intl.DateTimeFormat` already does, correctly, for any
 * locale, so neither needed to exist.
 *
 * `Intl.DateTimeFormat` is cheap to call but not free to construct, so
 * instances are cached per locale/options pair.
 */

const dateTimeFormats = new Map<string, Intl.DateTimeFormat>()

function dateTimeFormat(locale: string, options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}:${JSON.stringify(options ?? {})}`
  let format = dateTimeFormats.get(key)
  if (!format) {
    format = new Intl.DateTimeFormat(locale, options)
    dateTimeFormats.set(key, format)
  }
  return format
}

/** Formats a `Date`, or an ISO date/date-time string, for `locale`. */
export function formatDate(date: Date | string, locale: string, options?: Intl.DateTimeFormatOptions): string {
  const value = typeof date === "string" ? new Date(date) : date
  return dateTimeFormat(locale, options).format(value)
}

const relativeTimeFormats = new Map<string, Intl.RelativeTimeFormat>()

function relativeTimeFormat(locale: string, options?: Intl.RelativeTimeFormatOptions): Intl.RelativeTimeFormat {
  const key = `${locale}:${JSON.stringify(options ?? {})}`
  let format = relativeTimeFormats.get(key)
  if (!format) {
    format = new Intl.RelativeTimeFormat(locale, options)
    relativeTimeFormats.set(key, format)
  }
  return format
}

/** Seconds in each unit, coarsest unit last, used to pick the unit `formatRelativeDate` reports in. */
const RELATIVE_TIME_UNITS: { unit: Intl.RelativeTimeFormatUnit; seconds: number }[] = [
  { unit: "years", seconds: 60 * 60 * 24 * 365.25 },
  { unit: "months", seconds: (60 * 60 * 24 * 365.25) / 12 },
  { unit: "weeks", seconds: 60 * 60 * 24 * 7 },
  { unit: "days", seconds: 60 * 60 * 24 },
  { unit: "hours", seconds: 60 * 60 },
  { unit: "minutes", seconds: 60 },
  { unit: "seconds", seconds: 1 },
]

/**
 * Formats `date` relative to `now` — "3 dager siden", "in 2 hours" — picking
 * the coarsest unit that still rounds to at least 1, so a date 25 hours ago
 * reads "yesterday" rather than "25 hours ago".
 */
export function formatRelativeDate(
  date: Date | string,
  locale: string,
  now: Date = new Date(),
  options?: Intl.RelativeTimeFormatOptions,
): string {
  const value = typeof date === "string" ? new Date(date) : date
  const elapsedSeconds = (value.getTime() - now.getTime()) / 1000

  for (const { unit, seconds } of RELATIVE_TIME_UNITS) {
    if (Math.abs(elapsedSeconds) >= seconds || unit === "seconds") {
      return relativeTimeFormat(locale, { numeric: "auto", ...options }).format(Math.round(elapsedSeconds / seconds), unit)
    }
  }

  // Unreachable: the "seconds" entry above always matches.
  return relativeTimeFormat(locale, options).format(0, "seconds")
}
