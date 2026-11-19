import { SubPages } from "@lmfaole/designsystem/components/sub-pages"

import { ANY_APPS, appSubPages, isHomeApp, type AnyAppId } from "../lib/apps"
import { appUrl } from "../lib/base-url"
import { samePage } from "../lib/nav"
import { switcherLinks } from "../lib/switcher"

/** The pages under a page of an app, as the design system's `SubPages`: an icon, the name and one line of what is on each. Nothing where the page has none. `to` is the page's path in the registry (`/adguard`). */
export function AppSubPages({ app, to }: { app: AnyAppId; to: string }) {
  const pages = appSubPages(app, to)
  return <SubPages label={`Under ${ANY_APPS[app].label}`} pages={pages.map((page) => ({ href: appUrl(page.to), label: page.label, icon: page.icon, description: page.description }))} />
}

/** The other apps of the home server and the media hub, on the front page of a home app: how a reader moves to another app. Nothing in a media app, whose first crumb is the hub. */
export function AppSwitcher({ app, path }: { app: AnyAppId; path: string }) {
  if (!isHomeApp(app) || !samePage(appUrl("/"), path)) return null
  return <SubPages label="Andre apper" pages={switcherLinks(app).filter((link) => !link.current).map((link) => ({ href: link.href, label: link.label, icon: link.icon, description: link.description }))} />
}

