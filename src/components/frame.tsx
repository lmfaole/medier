import { NavBar } from "@lmfaole/designsystem/components/nav-bar"
import { PageLayout } from "@lmfaole/designsystem/components/page-layout"
import { isNew } from "@lmfaole/designsystem/lib/onboarding"
import { NewBadge } from "@lmfaole/designsystem/components/new-badge"
import type { ReactNode } from "react"

export type Place = "front" | "music" | "film" | "history" | "week"

/**
 * The frame of every page: the way between the app's five places (a bar at the foot on a phone, a rail from tablet width), and the page's own column. It is here and not in the
 * layout because an element made in an `.astro` file cannot be handed to a React component as a prop (`nav`); `current` is the place the page is in, none for a page that is in none.
 */
/** A place that has just come, with «Nytt» beside it in the navigation until `until` or until it has been opened (`seen`). */
export interface Fresh {
  place: Place
  until: string
  now: string
  seen: boolean
}

export function Frame({ base, current, width, fresh, children }: { base: string; current?: Place | undefined; width: "reading" | "pane"; fresh?: Fresh | undefined; children: ReactNode }) {
  const places = [
    { key: "front", label: "Forside", href: base, icon: "home" },
    { key: "music", label: "Musikk", href: `${base}musikk/`, icon: "music" },
    { key: "film", label: "Film", href: `${base}film-og-tv/`, icon: "film" },
    { key: "history", label: "Historikk", href: `${base}historikk/`, icon: "history" },
    { key: "week", label: "Wrapped", href: `${base}uke/`, icon: "calendar" },
  ] as const
  return (
    <PageLayout width={width} nav={<NavBar label="Hovedmeny" title="Medier" items={places.map((place) => ({ ...place, current: place.key === current, ...(fresh?.place === place.key && !fresh.seen && isNew(fresh.until, fresh.now) ? { badge: <NewBadge until={fresh.until} now={fresh.now} /> } : {}) }))} />}>
      {children}
    </PageLayout>
  )
}
