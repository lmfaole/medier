import { NavBar } from "@lmfaole/designsystem/components/nav-bar"

import { ANY_APPS, appNavLabel, appTopPages, type AnyAppId } from "../lib/apps"
import { appUrl } from "../lib/base-url"
import { currentSection } from "../lib/nav"

/**
 * The navigation of an app: its top-level pages (`appTopPages`, at most five) as the design system's `NavBar`, a bar at the foot of the
 * screen on a phone and a rail at the left from tablet width. The same on every page of the app, the section the visitor is in marked;
 * the page of one thing marks the page that lists the app's things. Rendered on the server, with no script.
 */
export function AppNav({ app, path }: { app: AnyAppId; path: string }) {
  const current = currentSection(app, path)
  return (
    <NavBar
      label={appNavLabel(app)}
      title={ANY_APPS[app].label}
      items={appTopPages(app).map((page) => ({ key: page.to, label: page.label, href: appUrl(page.to), icon: page.icon, current: page.to === current }))}
    />
  )
}
