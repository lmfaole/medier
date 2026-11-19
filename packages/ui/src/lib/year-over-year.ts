/** Each whole month of the latest year set against the same month a year before: the rows of the change chart on a retrospective's month page. */

export interface MonthPlays {
  /** The first day of the month, `YYYY-MM-DD`. */
  start: string
  plays: number
  ongoing: boolean
}

export interface YearOverYear {
  rows: { label: string; from: number; to: number }[]
  fromYear: string
  toYear: string
}

/** The months in the newest year that has at least `MIN_PAIRS` whole months with a whole month a year earlier, oldest first; `null` when no year has enough to say anything. */
export const MIN_PAIRS = 3

export function yearOverYear(months: readonly MonthPlays[], label: (start: string) => string): YearOverYear | null {
  const whole = new Map(months.filter((month) => !month.ongoing).map((month) => [month.start.slice(0, 7), month.plays]))
  const years = [...new Set([...whole.keys()].map((key) => Number(key.slice(0, 4))))].toSorted((a, b) => b - a)
  for (const year of years) {
    const rows = [...whole]
      .filter(([key]) => Number(key.slice(0, 4)) === year && whole.has(`${year - 1}${key.slice(4)}`))
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([key, plays]) => ({ label: label(`${key}-01`), from: whole.get(`${year - 1}${key.slice(4)}`) ?? 0, to: plays }))
    if (rows.length >= MIN_PAIRS) return { rows, fromYear: String(year - 1), toYear: String(year) }
  }
  return null
}
