import { strict as assert } from "node:assert"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"

import { APP_IDS, APPS, FEATURE_PAGES, FEATURES, type Feature } from "../packages/ui/src/lib/apps.ts"

const root = join(import.meta.dirname, "..")
const MEDIA_APPS = ["music", "podkast", "film", "tv", "games", "books", "boardgames"]
const STANDARD_ROUTES = ["index", "historikk"]

/** The top-level page names of an app: the pages of Astro (`pages/`, a file or a folder). */
function pageNames(app: string): string[] {
  const source = join(root, "apps", app, "web", "src")
  return readdirSync(join(source, "pages")).map((entry) => entry.replace(/\.(?:tsx?|astro)$/, ""))
}

/** The addresses an app's menu links, as plain strings (a removed page is no longer in the registry's types, which is what the tests below check for). */
const linksOf = (id: (typeof APP_IDS)[number]): string[] => APPS[id].pages.map((page): string => page.to)

/** The standard pages an app has chosen not to have: none. */
const WITHOUT: Readonly<Record<string, readonly string[]>> = {}

test("every media app has the standard pages", () => {
  for (const app of MEDIA_APPS) {
    const pages = pageNames(app)
    for (const page of STANDARD_ROUTES.filter((route) => !WITHOUT[app]?.includes(route))) assert.ok(pages.includes(page), `${app} has no ${page} page`)
  }
})

test("an optional service is a page, a link and a browser test in the apps that have it, and none of them, nor a preview, in the apps that do not", () => {
  // Not every app has a preview for every page, so a preview is only checked for being left behind.
  const previews = readFileSync(join(root, "packages", "ui", "src", "lib", "og-pages.json"), "utf8")
  const browserTests = readFileSync(join(root, "e2e", "pages.ts"), "utf8")
  const problems: string[] = []
  for (const id of APP_IDS) {
    const pages = pageNames(id)
    const features: readonly Feature[] = APPS[id].features
    for (const feature of FEATURES) {
      const path = FEATURE_PAGES[feature]
      const wanted = features.includes(feature)
      const has = {
        file: pages.includes(path.slice(1)),
        link: APPS[id].pages.some((page) => page.to === path),
        test: browserTests.includes(`app: "${id}", path: "${path}`),
      }
      for (const [part, present] of Object.entries(has)) if (present !== wanted) problems.push(`${id} ${wanted ? "has" : "has no"} ${feature}, but ${present ? "has" : "lacks"} its ${part}`)
      if (!wanted && previews.includes(`"id": "${id}:${path}"`)) problems.push(`${id} has no ${feature}, but keeps its preview`)
    }
  }
  assert.deepEqual(problems, [])
})

test("film has no library and no franchise page: no file, no link and no browser test; the franchise of a film is still a section on its own page", () => {
  assert.ok(!pageNames("film").includes("bibliotek"), "film still has bibliotek.astro")
  assert.ok(!pageNames("film").includes("franchiser"), "film still has franchiser.astro")
  assert.ok(!linksOf("film").some((to) => to === "/bibliotek" || to === "/franchiser"), "film still links them")
  assert.deepEqual(APPS.film.features, [])
  assert.ok(!readFileSync(join(root, "e2e", "pages.ts"), "utf8").includes('app: "film", path: "/franchiser'))
  // The franchise section on a film's own page stays: it comes from the register, not from a page of franchises.
  assert.ok(readFileSync(join(root, "packages", "watch", "src", "pages", "entity-model.ts"), "utf8").includes("franchiseSection"))
})

test("tv has none of them either", () => {
  assert.ok(!pageNames("tv").includes("bibliotek") && !pageNames("tv").includes("franchiser"))
  assert.ok(!linksOf("tv").some((to) => to === "/bibliotek" || to === "/franchiser"))
})

test("no media app has an on-this-day page: no file, no link, no browser test, no preview, and no snapshot file for a day", () => {
  const browserTests = readFileSync(join(root, "e2e", "pages.ts"), "utf8")
  const previews = readFileSync(join(root, "packages", "ui", "src", "lib", "og-pages.json"), "utf8")
  const site = readFileSync(join(root, "packages", "content", "src", "collections", "site.ts"), "utf8")
  const problems: string[] = []
  for (const id of APP_IDS) {
    if (pageNames(id).includes("minner")) problems.push(`${id} still has minner.astro`)
    if (linksOf(id).includes("/minner")) problems.push(`${id} still links /minner`)
    if (browserTests.includes(`app: "${id}", path: "/minner`)) problems.push(`${id} still has a browser test of /minner`)
    if (previews.includes(`"id": "${id}:/minner"`)) problems.push(`${id} still has a preview of /minner`)
    if (site.includes(`"${id}:/minner"`)) problems.push(`${id} still has /minner in the site content`)
  }
  for (const file of ["packages/watch/src/snapshot.ts", "packages/shelf/src/api.ts", "apps/podkast/web/src/server/snapshot.ts"]) {
    if (readFileSync(join(root, file), "utf8").includes("memories.json")) problems.push(`${file} still snapshots memories.json`)
  }
  assert.deepEqual(problems, [])
})

test("film, games, tv, books and boardgames go through their history a year at a time; music and podkast a month", () => {
  const page = (app: string) => readFileSync(join(root, "apps", app, "web", "src", "pages", "historikk.astro"), "utf8")
  for (const app of ["film", "games", "tv", "books", "boardgames"]) {
    assert.ok(page(app).includes("YearSearch") && page(app).includes("yearHistoryRequest"), `${app} is not a year at a time`)
    assert.ok(!page(app).includes("MonthSearch"), `${app} still asks for a month`)
    assert.ok(page(app).includes("legacyYearOf"), `${app} does not land an old ?month= link on its year`)
  }
  for (const app of ["music", "podkast"]) {
    assert.ok(page(app).includes("MonthSearch") && !page(app).includes("YearSearch"), `${app} must stay a month at a time`)
  }
})
