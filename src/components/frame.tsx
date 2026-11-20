import { NavBar } from "@lmfaole/designsystem/components/nav-bar"
import { PageLayout } from "@lmfaole/designsystem/components/page-layout"
import type { ReactNode } from "react"

export type Place = "front" | "music" | "film" | "week"

/**
 * The frame of every page: the way between the app's four places (a bar at the foot on a phone, a rail from tablet width), and the page's own column. It is here and not in the
 * layout because an element made in an `.astro` file cannot be handed to a React component as a prop (`nav`); `current` is the place the page is in, none for a page that is in none.
 */
export function Frame({ base, current, width, children }: { base: string; current?: Place | undefined; width: "reading" | "pane"; children: ReactNode }) {
  const places = [
    { key: "front", label: "Forside", href: base, icon: "home" },
    { key: "music", label: "Musikk", href: `${base}musikk/`, icon: "music" },
    { key: "film", label: "Film", href: `${base}film-og-tv/`, icon: "film" },
    { key: "week", label: "Wrapped", href: `${base}uke/`, icon: "calendar" },
  ] as const
  return (
    <PageLayout width={width} nav={<NavBar label="Hovedmeny" title="Medier" items={places.map((place) => ({ ...place, current: place.key === current }))} />}>
      {children}
    </PageLayout>
  )
}
