// Astro: plain HTML, no directive.

import { Minus, TrendingDown, TrendingUp } from "lucide-react"
import type { ReactNode } from "react"

import { NOTHING_PLAYED } from "../lib/empty-states"
import { Card, CardContent, CardHeader, CardTitle } from "@lmfaole/designsystem/components/card"

export interface Trend {
  direction: "up" | "down" | "same"
  /** Always positive: the direction says which way. */
  percent: number
}

/** A week, a month or a year. */
export type PeriodKind = "week" | "month" | "year"

const ICONS = { up: TrendingUp, down: TrendingDown, same: Minus } as const

/** What a screen reader says of the change; the icon and the percent are what everyone else has. */
const SAID = { up: "opp fra", down: "ned fra", same: "like mange som" } as const

/** What a period is compared with, said to a screen reader. */
const BEFORE = { week: "uken før", month: "måneden før", year: "året før" } as const

/** How the plays differ from the period before; nothing when that cannot be compared. */
export function trendOf(change: number | null): Trend | null {
  if (change === null) return null
  return { direction: change === 0 ? "same" : change > 0 ? "up" : "down", percent: Math.abs(change) }
}

/**
 * The card of one week, month or year: its title («Uke 45»), then its plays and how they differ from the one before as an icon for more or fewer
 * («148 avspillinger ↓ 53 %»), then what led, under each other (`children`, usually an `AvatarList`). What it is compared with («uken før») follows from
 * `kind` and is said to a screen reader. A period with no plays says so in the place of the numbers.
 */
export function PeriodCard({ kind, title, status, plays, empty = false, trend, children }: { kind: PeriodKind; title: string; status?: string | undefined; plays: string; empty?: boolean; trend: Trend | null; children?: ReactNode }) {
  const Icon = trend === null ? null : ICONS[trend.direction]
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {title}
          {status === undefined ? null : <span className="ml-2 text-sm font-normal text-muted-foreground">{status}</span>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3">
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {empty ? (
              <span>{NOTHING_PLAYED}</span>
            ) : (
              <>
                <span>{plays} avspillinger</span>
                {trend === null || Icon === null ? null : (
                  <span className="inline-flex items-center gap-1">
                    <Icon className="size-4" aria-hidden="true" />
                    <span>{trend.percent} %</span>
                    <span className="sr-only">
                      {SAID[trend.direction]} {BEFORE[kind]}
                    </span>
                  </span>
                )}
              </>
            )}
          </p>
          {children}
        </div>
      </CardContent>
    </Card>
  )
}
