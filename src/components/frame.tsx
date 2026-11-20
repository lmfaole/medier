import type { NavItem } from "@lmfaole/designsystem/components/nav-bar"
import { PageLayout } from "@lmfaole/designsystem/components/page-layout"
import type { ReactNode } from "react"

export type Place = "front" | "music" | "film" | "tv" | "settings"

/**
 * The places of the app, for its `NavBar` (a bar at the foot on a phone, which scrolls sideways once they are more than fit, and a rail from tablet width): Forside, Musikk, Film, TV and, last,
 * Innstillinger (current on all its subpages). The history and the wrapped of each are under Musikk, Film and TV (`SubPages` on their overviews). `current` is the place the page is in, none for a
 * page that is in none.
 */
export function navItems(base: string, current: Place | undefined): NavItem[] {
  const places = [
    { key: "front", label: "Forside", href: base, icon: "home" },
    { key: "music", label: "Musikk", href: `${base}musikk/`, icon: "music" },
    { key: "film", label: "Film", href: `${base}film/`, icon: "film" },
    { key: "tv", label: "TV", href: `${base}tv/`, icon: "tv" },
    { key: "settings", label: "Innstillinger", href: `${base}innstillinger/`, icon: "settings" },
  ] as const
  return places.map((place) => ({ ...place, current: place.key === current }))
}

/**
 * The frame of every page: the bar between the places, and the page's own column. The bar comes in from the Astro layout as the named slot `nav` (an island, so the part of it that scrolls the
 * current place into view on a phone runs); a slot is the way an element made in an `.astro` file reaches a React component.
 */
export function Frame({ width, nav, children }: { width: "reading" | "pane"; nav?: ReactNode; children: ReactNode }) {
  return (
    <PageLayout width={width} nav={nav}>
      {children}
    </PageLayout>
  )
}
