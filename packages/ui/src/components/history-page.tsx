// Astro: plain HTML, no directive; the picker is links.

import { formatMonth } from "@designsystem/intl/listening"

import { searchHref } from "../lib/href"
import { coverRatioOf } from "../lib/cover-ratio"
import type { AppId } from "../lib/apps"
import { NOTHING_IN_KIND } from "../lib/empty-states"
import { PageHeader } from "./page-header"
import { PeriodSteps } from "./period-steps"
import { MediaRows, type MediaRow } from "./media-rows"
import { PageSection } from "@lmfaole/designsystem/components/page-section"
import { Stack } from "@lmfaole/designsystem/components/layout"
import { Text } from "@lmfaole/designsystem/components/text"

/** The time frame of a history: a month (`?month=YYYY-MM`) or a year (`?year=YYYY`), the one `selected` of the `periods` there are (`selected` is empty when there is nothing at all). */
export interface HistoryPeriod {
  kind: "month" | "year"
  selected: string
  periods: string[]
}

/**
 * «Historikk»: every entry of one month or year, the newest without one chosen, as rows of a picture, a title, a line under it and the date,
 * with a select of the periods there are. The same page for every app; each says only what the rows and its summary line are, and the
 * rows' pictures take the shape of the app's kind.
 */
export function HistoryPage({ app, period, rows, summary, listTitle }: { app: AppId; period: HistoryPeriod; rows: readonly MediaRow[]; summary: string; listTitle: string }) {
  const { kind, selected, periods } = period
  const formatLabel = kind === "month" ? formatMonth : (year: string) => year
  const steps = selected ? <PeriodSteps kind={kind} periods={periods} selected={selected} formatLabel={formatLabel} hrefTo={(value) => searchHref("/historikk", { [kind]: value })} /> : undefined
  return (
    <>
      <PageHeader title="Historikk" lead={selected ? formatLabel(selected) : undefined} actions={steps} />
      <Stack gap="md">
        <Text size="lg">{summary}</Text>
        <PageSection id="history-list" title={listTitle}>
          {rows.length === 0 ? <Text size="sm" tone="muted">{NOTHING_IN_KIND[kind]}</Text> : <MediaRows rows={rows} coverRatio={coverRatioOf(app)} />}
        </PageSection>
      </Stack>
    </>
  )
}
