// The words and numbers of the cards of `/tilbakeblikk/uke`, `/maaned` and `/aar`: which week it is, and how the plays differ from the one before.

import { isoWeek } from '@designsystem/intl/time'

export interface Trend {
  direction: 'up' | 'down' | 'same'
  /** Always positive: the direction says which way. */
  percent: number
}

/** How the plays differ from the one before; nothing when that cannot be compared. */
export function trendOf(change: number | null): Trend | null {
  if (change === null) return null
  return { direction: change === 0 ? 'same' : change > 0 ? 'up' : 'down', percent: Math.abs(change) }
}

/** «Uke 45»; with the year («Uke 52 · 2025») when the week is not of the year [newestYear], the year of the newest week on the page. */
export function weekTitle(start: string, newestYear: number): string {
  const { week, year } = isoWeek(start)
  return year === newestYear ? `Uke ${week}` : `Uke ${week} · ${year}`
}
