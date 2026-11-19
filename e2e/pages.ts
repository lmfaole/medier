/**
 * The pages the browser tests visit, one entry per page of the apps under
 * test. Each app is served from its own build by the `webServer` entries of
 * `playwright.config.ts`, on the port named here.
 */

export interface AppUnderTest {
  name: string
  port: number
  /** Where Wrangler's inspector listens, one per app so the apps can start together. */
  inspectorPort: number
  /** The path the app is mounted under (sky.lmfaole.party/apps/medier/musikk); an app on a host of its own has none. */
  basePath?: string
  /** A home app: served alone by the media server (no hub to link to), from the files of this folder (`APPER_DIR`, relative to the repository). */
  apperDir?: string
}

export const APPS_UNDER_TEST: readonly AppUnderTest[] = [
  { name: "music", port: 8812, inspectorPort: 9332, basePath: "/apps/medier/musikk" },
  { name: "podkast", port: 8816, inspectorPort: 9336, basePath: "/apps/medier/podkast" },
  { name: "film", port: 8818, inspectorPort: 9338, basePath: "/apps/medier/film" },
  { name: "tv", port: 8820, inspectorPort: 9340, basePath: "/apps/medier/tv" },
  { name: "games", port: 8822, inspectorPort: 9342, basePath: "/apps/medier/spill" },
  { name: "books", port: 8824, inspectorPort: 9344, basePath: "/apps/medier/boker" },
  { name: "boardgames", port: 8826, inspectorPort: 9346, basePath: "/apps/medier/brettspill" },
  { name: "medier", port: 8830, inspectorPort: 9350, basePath: "/apps/medier" },
  { name: "penger", port: 8832, inspectorPort: 9352, basePath: "/apps/hjemmeserver/penger", apperDir: "apps/penger/fixtures/full" },
  { name: "hjem", port: 8834, inspectorPort: 9354, basePath: "/apps/hjemmeserver/hjem", apperDir: "apps/hjem/fixtures/full" },
  { name: "innboks", port: 8838, inspectorPort: 9358, basePath: "/apps/hjemmeserver/innboks", apperDir: "apps/innboks/fixtures" },
  { name: "miniflux", port: 8836, inspectorPort: 9356, basePath: "/apps/hjemmeserver/miniflux", apperDir: "apps/miniflux/fixtures/full" },
  { name: "work", port: 8814, inspectorPort: 9334 },
  { name: "forside", port: 8815, inspectorPort: 9335 },
]

export interface PageUnderTest {
  app: string
  path: string
  /** What the page's `<h1>` says: the test that the page rendered, not just answered. */
  heading: string | RegExp
  /**
   * Axe rules this page is known to break, found when the tests were set up. The
   * accessibility test ignores exactly these and fails on any other serious
   * rule, so a new violation is caught while these stay on the to-do list. Empty
   * a list when the page is fixed.
   */
  knownViolations?: readonly string[]
  /** Text that has to be on the page for a reader without JavaScript: the content is in the HTML the server sends. */
  withoutJs: string | RegExp
  /** An Astro page: how many React islands (`astro-island`) it sends, all of which have to hydrate. Left out, the page has none. */
  islands?: number
  /** An Astro page with a server island: the text that its response puts in the page once the browser has fetched it. */
  serverIsland?: string | RegExp
}

export const PAGES: readonly PageUnderTest[] = [
  // Only the phone viewports find the scrollable region without keyboard access.
  { app: "music", path: "/", heading: "Min musikk", withoutJs: /Nylig spilt/ },
  { app: "music", path: "/tilbakeblikk", heading: "Tilbakeblikk", withoutJs: /Uke for uke/ },
  { app: "music", path: "/tilbakeblikk/uke", heading: "Uke for uke", withoutJs: /Uke fra/ },
  { app: "music", path: "/tilbakeblikk/maaned", heading: "Måned for måned", withoutJs: /avspillinger|ingenting/ },
  { app: "music", path: "/tilbakeblikk/aar", heading: "År for år", withoutJs: /avspillinger|ingenting/ },
  { app: "music", path: "/historikk?month=2021-03", heading: "Historikk", withoutJs: /Alle avspillinger/ },
  { app: "music", path: "/bibliotek", heading: "Bibliotek", withoutJs: /Det jeg eier og ønsker meg|Ingenting/, islands: 1 },
  { app: "podkast", path: "/", heading: "Podkast", withoutJs: /Sist spilt/ },
  { app: "podkast", path: "/historikk?month=2026-10", heading: "Historikk", withoutJs: /Alle avspillinger/ },
  { app: "film", path: "/", heading: "Film", withoutJs: /Sist sett|Ingen filmer/ },
  { app: "film", path: "/historikk", heading: "Historikk", withoutJs: /Alle visninger|Ingenting/ },
  { app: "film", path: "/kinoer", heading: "Kinoer", withoutJs: /\d+ kinoer?, |Ingen kinoer/ },
  { app: "tv", path: "/", heading: "TV-serier", withoutJs: /Ingen episoder|Sist sett/ },
  { app: "tv", path: "/historikk", heading: "Historikk", withoutJs: /Alle visninger|Ingenting/ },
  { app: "games", path: "/", heading: "Spill", withoutJs: /Ingenting|Sist|Best vurdert|ennå/, islands: 1 },
  { app: "games", path: "/historikk", heading: "Historikk", withoutJs: /linje|Ingenting/, islands: 1 },
  { app: "games", path: "/bibliotek", heading: "Bibliotek", withoutJs: /Det jeg eier og ønsker meg|ingenting her ennå|Ingenting/, islands: 2 },
  { app: "books", path: "/", heading: "Bøker", withoutJs: /Ingenting|Sist|Best vurdert|ennå/, islands: 1 },
  { app: "books", path: "/historikk", heading: "Historikk", withoutJs: /linje|Ingenting/, islands: 1 },
  { app: "books", path: "/bibliotek", heading: "Bibliotek", withoutJs: /Det jeg eier og ønsker meg|ingenting her ennå|Ingenting/, islands: 2 },
  { app: "boardgames", path: "/", heading: "Brettspill", withoutJs: /Ingenting|Sist|Best vurdert|ennå/, islands: 1 },
  { app: "boardgames", path: "/historikk", heading: "Historikk", withoutJs: /linje|Ingenting/, islands: 1 },
  { app: "boardgames", path: "/bibliotek", heading: "Bibliotek", withoutJs: /Det jeg eier og ønsker meg|ingenting her ennå|Ingenting/, islands: 2 },
  { app: "work", path: "/", heading: "Ole Jørgen Bakken", withoutJs: /Erfaring/ },
  { app: "forside", path: "/", heading: "Ole Jørgen Bakken", withoutJs: /senior frontend-utvikler/ },
  { app: "forside", path: "/medier", heading: "Medier", withoutJs: /Sist/, serverIsland: /Sist registrert/ },
  { app: "medier", path: "/", heading: "Medier", withoutJs: /Siste/ },
  { app: "penger", path: "/", heading: "Penger", withoutJs: /Per måned/ },
  { app: "penger", path: "/aktive", heading: "Aktive abonnement", withoutJs: /Strømmetjeneste A/ },
  { app: "penger", path: "/avsluttede", heading: "Avsluttede abonnement", withoutJs: /Spillklubben/ },
  { app: "miniflux", path: "/", heading: "Topp 10 siste døgn", withoutJs: /Rådhuset åpner/ },
  { app: "miniflux", path: "/kategori/Teknologi", heading: "Teknologi", withoutJs: /Slik skriver du tester/ },
  { app: "miniflux", path: "/sak?u=https%3A%2F%2Fdagsnytt.example%2F4-dette-skjer-med-havnetomten-n-", heading: "Rådhuset åpner for flere boliger ved fjorden", withoutJs: /Bygger på/, islands: 1 },
  { app: "miniflux", path: "/logg", heading: "Fullstendig logg", withoutJs: /november 2026/ },
  { app: "miniflux", path: "/logg/2026-11", heading: "november 2026", withoutJs: /235 saker/ },
  { app: "miniflux", path: "/kilder", heading: "Kilder", withoutJs: /Vekten sier/ },
  { app: "miniflux", path: "/folger", heading: "Fulgte saker", withoutJs: /Sakene du følger/, islands: 1 },
  { app: "miniflux", path: "/sok", heading: "Søk", withoutJs: /Søk i tittel/, islands: 1 },
  { app: "innboks", path: "/", heading: "Innboks", withoutJs: /Slipp filer her/, islands: 1 },
  { app: "innboks", path: "/hjelp", heading: "Hva kan Innboks gjøre?", withoutJs: /Store filer og dårlig nett/ },
  { app: "hjem", path: "/", heading: "Hjem", withoutJs: /Tjenester/, islands: 1 },
  { app: "hjem", path: "/status", heading: "Status", withoutJs: /Sikkerhetskopi/ },
  { app: "hjem", path: "/status/maskin", heading: "Maskin", withoutJs: /Oppetid/ },
  { app: "hjem", path: "/status/drift", heading: "Drift", withoutJs: /Containere/ },
  { app: "hjem", path: "/adguard", heading: "AdGuard", withoutJs: /Nettsteder med flest blokkerte/, islands: 1 },
  { app: "hjem", path: "/adguard/enheter", heading: "Enheter", withoutJs: /Stue-TV/ },
  { app: "hjem", path: "/adguard/historikk", heading: "Historikk", withoutJs: /Tall per dag/, islands: 1 },
  { app: "hjem", path: "/adguard/drift", heading: "Drift", withoutJs: /Hurtigbuffer/ },
  { app: "hjem", path: "/nett", heading: "Nettet", withoutJs: /På nett nå/ },
  { app: "hjem", path: "/nett/hastighet", heading: "Hastighet", withoutJs: /Siste målinger/, islands: 1 },
  { app: "hjem", path: "/nett/kvalitet", heading: "Kvalitet", withoutJs: /Utfall/, islands: 1 },
  { app: "forside", path: "/kilder", heading: "Kilder", withoutJs: /Slik fungerer det/, islands: 1 },
]

/** Where an app is served: its own port, under the path it is mounted at (work has none). */
export function rootOf(app: AppUnderTest): string {
  return `http://localhost:${app.port}${app.basePath ?? ""}`
}

export function urlOf(page: PageUnderTest): string {
  const app = APPS_UNDER_TEST.find((candidate) => candidate.name === page.app)
  if (app === undefined) throw new Error(`${page.app} is not an app under test`)
  return `${rootOf(app)}${page.path}`
}
