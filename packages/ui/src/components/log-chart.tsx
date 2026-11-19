import { formatDay, formatMonth, formatShortDay } from "@designsystem/intl/listening"
import { pluralize } from "@designsystem/intl/plural"

import { calendarDays, logSeries, type SeriesEntry } from "../lib/log-series"
import { CalendarHeatmap } from "@lmfaole/designsystem/components/calendar-heatmap"
import { ColumnChart } from "@lmfaole/designsystem/components/column-chart"
import { PageSection } from "@lmfaole/designsystem/components/page-section"
import { Text } from "@lmfaole/designsystem/components/text"

const HEIGHT = 180
/** Labels under the columns, at most about this many. */
const LABELS = 5

interface LogChartProps {
  /** The title of the chart: «Loggen», «Når du så den». */
  title: string
  entries: readonly SeriesEntry[]
  /** What one line is called: «linje», «visning». */
  noun: { one: string; many: string }
  /** The app's amount (hours, pages), drawn instead of the lines where the log has any; none for an app that counts none. */
  amount?: { label: string; format: (amount: number) => string } | null | undefined
}

/**
 * A log as one chart along time, from the first line to the last, the empty days or months between them too: the lines
 * for each, or the amount where there is one. A log with fewer than three bars is no chart (it says nothing): the page's tiles
 * hold its counts. A log that spans more than two months also has the rhythm of its last year, day by day (`CalendarHeatmap`). An amount with no day (a total) is counted but not drawn on any day.
 */
export function LogChart({ title, entries, noun, amount = null }: LogChartProps) {
  const series = logSeries(entries)
  // A log of fewer than three bars says nothing as a chart: its counts are the page's tiles.
  if (series.first === null || series.last === null || series.labels.length < 3) return null
  const format = series.unit === "day" ? formatShortDay : formatMonth
  const labelEvery = Math.max(1, Math.ceil(series.labels.length / LABELS))
  const total = entries.reduce((sum, entry) => sum + (entry.amount ?? 0), 0)
  const counted = amount !== null && total > 0 ? amount : null
  const byDay = counted !== null && series.amounts.some((value) => value > 0)
  const values = byDay ? series.amounts : series.lines
  const span = series.first === series.last ? formatDay(series.first) : `${formatDay(series.first)} til ${formatDay(series.last)}`
  const how = `${pluralize(entries.length, { one: `{count} ${noun.one}`, other: `{count} ${noun.many}` }, "nb-NO")}${counted === null ? "" : `, ${counted.format(total)}`}`
  const undated = series.undated === 0 ? "" : `, ${series.undated} uten dato`
  return (
    <PageSection id={`log-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} title={title}>
      <Text size="sm" tone="muted">{`${span}. ${how}${undated}.`}</Text>
      <ColumnChart
        data={series.labels.map((label, index) => ({ label, value: values[index] ?? 0 }))}
        ariaLabel={byDay && counted !== null ? `${counted.label} over tid` : `${noun.many} over tid`}
        valueLabel={byDay && counted !== null ? counted.label : noun.many.charAt(0).toLocaleUpperCase("nb-NO") + noun.many.slice(1)}
        height={HEIGHT}
        formatLabel={format}
        labelEvery={labelEvery}
        color="var(--series-1)"
      />
      {series.unit === "month" ? (
        <CalendarHeatmap days={calendarDays(entries)} ariaLabel={`${noun.many.charAt(0).toLocaleUpperCase("nb-NO")}${noun.many.slice(1)} per dag, siste året`} unit={noun.many} showTable />
      ) : null}
    </PageSection>
  )
}
