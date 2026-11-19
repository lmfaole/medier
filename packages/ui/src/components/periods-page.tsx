// Astro: plain HTML, no directive.

import type { ReactNode } from "react"

import { formatCount } from "@designsystem/intl/listening"
import { isoWeek, formatTime } from "@designsystem/intl/time"

import type { AppId } from "../lib/apps"
import { DumbbellChart } from "@lmfaole/designsystem/components/dumbbell-chart"
import { PageSection } from "@lmfaole/designsystem/components/page-section"

import { yearOverYear } from "../lib/year-over-year"
import { PageHeader } from "./page-header"
import { PeriodCard, trendOf, type PeriodKind } from "./period-card"

/** One period of a retrospective: the first day it covers (`YYYY-MM-DD`), its plays, the percent more or fewer than the one before (`null` when that cannot be compared) and what led. */
export interface PeriodEntry {
  start: string
  plays: number
  change: number | null
  /** Not over yet: its plays so far are not compared as a whole. */
  ongoing: boolean
  /** What led, under each other (an `AvatarList`), or nothing. */
  leaders: ReactNode
}

/** The path under `/tilbakeblikk` of each kind. */
const PATHS = { week: "uke", month: "maaned", year: "aar" } as const

/** «november 2026» is written «November 2026» as a title. */
const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

/** «Uke 45»; with the year («Uke 52 · 2025») when the week is not of the year [newestYear], the year of the newest week on the page. */
function titleOf(kind: PeriodKind, start: string, newestYear: number): string {
  if (kind === "year") return formatTime(start, "year")
  if (kind === "month") return capitalized(formatTime(start, "month"))
  const { week, year } = isoWeek(start)
  return year === newestYear ? `Uke ${week}` : `Uke ${week} · ${year}`
}

/**
 * «Uke for uke», «Måned for måned», «År for år»: the header of the app's retrospective page for [kind] (`<app>:/tilbakeblikk/<path>` in `og-pages.json`)
 * and a card for each period under it, the newest first. Each card's title and what it is compared with follow from the kind.
 */
export function PeriodsPage({ app, kind, periods }: { app: AppId; kind: PeriodKind; periods: readonly PeriodEntry[] }) {
  const first = periods[0]
  const newestYear = first === undefined ? 0 : isoWeek(first.start).year
  const compared = kind === "month" ? yearOverYear(periods, (start) => capitalized(formatTime(start, "month")).split(" ")[0] ?? start) : null
  return (
    <>
      <PageHeader page={`${app}:/tilbakeblikk/${PATHS[kind]}`} />
      {compared === null ? null : (
        <PageSection id="year-over-year" title="Mot samme måned i fjor">
          <DumbbellChart rows={compared.rows} fromLabel={compared.fromYear} toLabel={compared.toYear} ariaLabel={`Avspillinger per måned, ${compared.fromYear} mot ${compared.toYear}`} keepOrder showTable />
        </PageSection>
      )}
      <div className="grid items-start gap-4 xl:grid-cols-2">
        {periods.map((period) => (
          <PeriodCard key={period.start} kind={kind} title={titleOf(kind, period.start, newestYear)} status={period.ongoing ? "pågår" : undefined} plays={formatCount(period.plays)} empty={period.plays === 0} trend={trendOf(period.change)}>
            {period.leaders}
          </PeriodCard>
        ))}
      </div>
    </>
  )
}
