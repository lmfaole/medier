import { ANY_APPS, isHomeApp, type AnyAppId, type AppPageEntry } from "./apps.ts"
import { appUrl } from "./base-url.ts"
import { HUB, HUB_URL } from "./hub.ts"
import { listOfThings, registeredPage, samePage } from "./nav.ts"

export interface Trail {
  label: string
  href: string
  current: boolean
}

/**
 * Where a page is: the group first (`Medier` for a media app, which lists the apps; a home app has none), then the app, the page a
 * subpage is under, and the page itself last. The page of one thing (in no registry, named by `title`) hangs under the page that lists the
 * app's things (`listOfThings`). The front page of a home app has a trail of one item, which draws nothing.
 */
export function breadcrumbTrail(app: AnyAppId, path: string, base?: string, title?: string): Trail[] {
  const { label } = ANY_APPS[app]
  const front = appUrl("/", base)
  const onFront = samePage(front, path)
  const page = registeredPage(app, path, base)
  const pages: readonly AppPageEntry[] = ANY_APPS[app].pages
  const parent = page?.under === undefined ? undefined : pages.find((candidate) => candidate.to === page.under)
  const things = page === undefined && !onFront && title !== undefined ? listOfThings(app) : undefined
  return [
    ...(isHomeApp(app) ? [] : [{ label: HUB.label, href: HUB_URL, current: false }]),
    { label, href: front, current: onFront },
    ...(things === undefined || things.to === "/" ? [] : [{ label: things.label, href: appUrl(things.to, base), current: false }]),
    ...(parent === undefined ? [] : [{ label: parent.label, href: appUrl(parent.to, base), current: false }]),
    ...(page === undefined ? [] : [{ label: page.label, href: appUrl(page.to, base), current: true }]),
    ...(page === undefined && !onFront && title !== undefined ? [{ label: title, href: path, current: true }] : []),
  ]
}
