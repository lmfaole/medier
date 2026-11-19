// Display formatting only. What the numbers mean lives in `types.ts`, not here.

import { formatNumber } from '@designsystem/intl/number'

const HOUR_LABELS = Array.from({ length: 24 }, (_, hour) => hour.toString().padStart(2, '0'))

export function formatHourLabel(hour: number): string {
  return HOUR_LABELS[hour] ?? String(hour)
}

/** A share of a whole as a whole percentage, e.g. 0.874 → «87%». */
export function formatShare(part: number, whole: number): string {
  return formatNumber(whole === 0 ? 0 : part / whole, 'nb-NO', { style: 'percent', maximumFractionDigits: 0 })
}
