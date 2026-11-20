import { ChartCard } from "@lmfaole/designsystem/components/chart-card"
import { ColumnChart } from "@lmfaole/designsystem/components/column-chart"
import { summariseSeries } from "@lmfaole/designsystem/lib/chart-summary"

export interface TrendColumn {
  /** What the column is called under it and in the tooltip: unique within the chart. */
  label: string
  value: number
}

/** One column chart of plays over time, in a card, with the text that says what it shows. An island: the chart is drawn in the browser. */
export function PlaysChart({ title, description, ariaLabel, columns, labelEvery = 1 }: { title: string; description: string; ariaLabel: string; columns: readonly TrendColumn[]; labelEvery?: number }) {
  const data = [...columns]
  const summary = summariseSeries(data, { kind: "Søylediagram", valueLabel: "Avspillinger", ordered: true })
  return (
    <ChartCard title={title} description={description} empty={data.every((one) => one.value === 0)} emptyMessage="Ingen avspillinger i perioden.">
      <ColumnChart
        data={data}
        ariaLabel={ariaLabel}
        valueLabel="Avspillinger"
        height={200}
        labelEvery={labelEvery}
        showTable
        {...(summary === null ? {} : { summary })}
      />
    </ChartCard>
  )
}
