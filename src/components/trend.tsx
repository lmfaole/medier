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
