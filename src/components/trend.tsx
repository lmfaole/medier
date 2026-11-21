import { AreaChart } from "@lmfaole/designsystem/components/area-chart"
import { ChartCard } from "@lmfaole/designsystem/components/chart-card"
import { ColumnChart } from "@lmfaole/designsystem/components/column-chart"
import { summariseSeries } from "@lmfaole/designsystem/lib/chart-summary"

export interface TrendColumn {
  /** What the column is called under it and in the tooltip: unique within the chart. */
  label: string
  value: number
}

/** One column chart of plays over time, in a card, with the text that says what it shows. An island: the chart is drawn in the browser. */
export function PlaysChart({ title, description, ariaLabel, columns, labelEvery = 1, valueLabel = "Avspillinger", emptyMessage = "Ingen avspillinger i perioden." }: { title: string; description: string; ariaLabel: string; columns: readonly TrendColumn[]; labelEvery?: number; /** What a column counts: «Avspillinger», «Visninger». */ valueLabel?: string; emptyMessage?: string }) {
  const data = [...columns]
  const summary = summariseSeries(data, { kind: "Søylediagram", valueLabel, ordered: true })
  return (
    <ChartCard title={title} description={description} empty={data.every((one) => one.value === 0)} emptyMessage={emptyMessage}>
      <ColumnChart
        data={data}
        ariaLabel={ariaLabel}
        valueLabel={valueLabel}
        height={200}
        labelEvery={labelEvery}
        showTable
        {...(summary === null ? {} : { summary })}
      />
    </ChartCard>
  )
}

/** The plays of one thing over time as an area, in a card: where the line leaves zero is when it was first played, and its shape how that went on. An island: the chart is drawn in the browser. */
export function ListeningChart({ title, description, ariaLabel, summary, points }: { title: string; description: string; ariaLabel: string; /** What the chart shows in words: first played, most, now. */ summary: string; points: readonly TrendColumn[] }) {
  return (
    <ChartCard title={title} description={description} empty={points.every((one) => one.value === 0)} emptyMessage="Ingen avspillinger i perioden.">
      <AreaChart data={[...points]} ariaLabel={ariaLabel} valueLabel="Avspillinger" height={200} summary={summary} showTable />
    </ChartCard>
  )
}

/** The user's plays of each of the artist's studio albums in the order they came out, with this one picked out (`highlight`, its value over it, its label in bold), in a card. An island: the chart is drawn in the browser. */
export function DiscographyChart({ title, description, summary, ariaLabel, highlight, albums }: { title: string; description: string; summary: string; ariaLabel: string; highlight: string; albums: readonly { title: string; plays: number }[] }) {
  return (
    <ChartCard title={title} description={description}>
      <ColumnChart data={albums.map((album) => ({ label: album.title, value: album.plays }))} ariaLabel={ariaLabel} valueLabel="Avspillinger" height={220} summary={summary} highlight={highlight} showTable />
    </ChartCard>
  )
}
