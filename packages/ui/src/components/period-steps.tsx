import { PeriodPicker } from "@lmfaole/designsystem/components/period-picker"

const LABELS = { month: "Måned", year: "År", decade: "Tiår" } as const

interface PeriodStepsProps {
  /** What the periods are: it words the label of the select. */
  kind: keyof typeof LABELS
  periods: string[]
  selected: string
  formatLabel: (period: string) => string
  /** The address of one period. */
  hrefTo: (period: string) => string
}

/** The select of every period, the way through the months or years of a page. There are no back and forward arrows: the select is the only control. */
export function PeriodSteps({ kind, periods, selected, formatLabel, hrefTo }: PeriodStepsProps) {
  return <PeriodPicker periods={periods} selected={selected} hrefTo={hrefTo} formatLabel={formatLabel} label={LABELS[kind]} />
}
