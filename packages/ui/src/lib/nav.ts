import { ANY_APPS, FEATURE_PAGES, type AnyAppId, type AppPageEntry } from "./apps.ts"
import { appUrl } from "./base-url.ts"

/** Whether two addresses are the same page: a trailing slash does not make a different one. */
export function samePage(a: string, b: string): boolean {
  return a.replace(/\/+$/, "") === b.replace(/\/+$/, "")
}

/** The page of the registry that `path` is (the front page, `/`, is not looked up: it is the app's own address), or nothing for a page that is not in it (the page of one thing). */
export function registeredPage(app: AnyAppId, path: string, base?: string): AppPageEntry | undefined {
  return ANY_APPS[app].pages.find((candidate) => candidate.to !== "/" && samePage(appUrl(candidate.to, base), path))
}

/** The page that lists the things of an app, where the page of one thing belongs: its library when it has one, else its front page. */
export function listOfThings(app: AnyAppId): AppPageEntry {
  const pages: readonly AppPageEntry[] = ANY_APPS[app].pages
  const front = pages.find((page) => page.to === "/")
  return pages.find((page) => page.to === FEATURE_PAGES.library) ?? front ?? { to: "/", label: ANY_APPS[app].label, icon: "home", description: ANY_APPS[app].description }
}

/**
 * The top-level page of the app that `path` is in, which the navigation bar marks: the page itself when it is a top-level one, the
 * page a subpage is under, the front page for the front page, and for the page of one thing (which is in no registry) the page that lists
 * the app's things (`listOfThings`).
 */
export function currentSection(app: AnyAppId, path: string, base?: string): string {
  const front = appUrl("/", base)
  if (samePage(front, path)) return "/"
  const page = registeredPage(app, path, base)
  if (page === undefined) return listOfThings(app).to
  return page.under ?? page.to
}
