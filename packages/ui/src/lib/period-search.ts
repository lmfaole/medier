import { MONTH, YEAR } from "@designsystem/intl/listening"
import * as v from "valibot"

/** `?month=YYYY-MM` of a page a month at a time (the history): a month, or none, which means the newest. */
export const MonthSearch = v.object({ month: v.fallback(v.optional(v.pipe(v.string(), v.regex(MONTH))), undefined) })
export type MonthSearch = v.InferOutput<typeof MonthSearch>

/** `?year=YYYY` of a page a year at a time (the history of film, tv, games, books and boardgames): a year, or none, which means the newest. */
export const YearSearch = v.object({ year: v.fallback(v.optional(v.pipe(v.string(), v.regex(YEAR))), undefined) })
export type YearSearch = v.InferOutput<typeof YearSearch>

/** The year an old `?month=YYYY-MM` link is in, for a page that now goes a year at a time to send it on; none when the address has a year already, or no month. */
export function legacyYearOf(params: URLSearchParams): string | null {
  const year = params.get("year")
  if (year !== null && YEAR.test(year)) return null
  const month = params.get("month")
  return month !== null && MONTH.test(month) ? month.slice(0, 4) : null
}
