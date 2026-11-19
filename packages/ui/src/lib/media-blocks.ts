/** True when a chart of `data` would say something: at least two buckets have a value. */
export function enough(data: readonly { value: number }[]): boolean {
  return data.filter((bucket) => bucket.value > 0).length >= 2
}

/** The running total of buckets in order, oldest first. */
export function runningTotal<Bucket extends { label: string; value: number }>(months: readonly Bucket[]): { label: string; value: number }[] {
  let total = 0
  return months.map((month) => ({ label: month.label, value: (total += month.value) }))
}

/** Months (`YYYY-MM`) summed into years, oldest first. */
export function yearsOf(months: readonly { label: string; value: number }[]): { label: string; value: number }[] {
  const years = new Map<string, number>()
  for (const month of months) years.set(month.label.slice(0, 4), (years.get(month.label.slice(0, 4)) ?? 0) + month.value)
  return [...years].toSorted(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, value }))
}
