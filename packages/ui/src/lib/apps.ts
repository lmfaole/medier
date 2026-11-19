import type { IconName } from "@lmfaole/designsystem/lib/icons"
import {
  BookOpen,
  Clapperboard,
  Dices,
  Gamepad2,
  HousePlug,
  Inbox,
  Music,
  Podcast,
  Rss,
  Tv,
  Wallet,
  type LucideIcon,
} from "lucide-react"


/**
 * Every app in the monorepo and its pages, the one list the front pages' links
 * and the page previews are built from. Music is deployed on a path of `sky.lmfaole.party` (`/apps/medier/musikk`) and,
 * locally, its own `localhost` port (see `scripts/apps.ts`). Add an id and
 * an entry here when a new app joins, and a page when an app gets one.
 *
 * Paths are literal types (`as const`). An app's top-level pages (no `under`) are its navigation bar (`AppNav`), at most five; the pages
 * `under` another are listed on it (`AppSubPages`) and are the last but one crumb of the breadcrumbs. A page listed here is a page the app
 * must have: nothing checks the path against the app's pages any more.
 *
 * `group` says which page of `forside` lists the app (`/medier` today), and
 * `description` is the line under its name there.
 */
export const APP_IDS = ["music", "podkast", "film", "tv", "games", "books", "boardgames"] as const

/** The id of one app in the monorepo, e.g. "music". */
export type AppId = (typeof APP_IDS)[number]

/**
 * A service an app can opt into, with the page it brings. An app has a page only for the features it lists; the page
 * file, the link in `pages`, the preview in `og-pages.json` and the browser test follow from it
 * (`scripts/media-apps.test.ts` fails when they disagree).
 */
export const FEATURE_PAGES = { library: "/bibliotek" } as const

/** Every optional service there is. */
export const FEATURES = ["library"] as const

/** The name of one optional service: «library» is `/bibliotek` (things you can own). */
export type Feature = (typeof FEATURES)[number]

/** The page of `forside` that lists an app; `home` is the four owner apps of the home server (`HOME_APPS`), which no page of `forside` lists. */
export type AppGroup = "media" | "home"

interface AppDetails {
  /** Drawn on the app's mark, in its colour (`--app-<id>` in `theme.css`), wherever one app points at another. */
  icon: LucideIcon
  label: string
  /** One line on `forside`'s page for the app's group, under its name. */
  description: string
  href: string
  /** Local Vite dev server port, matching `scripts/apps.ts`. */
  devPort: number
  /** Which page of `forside` lists the app. */
  group: AppGroup
  /** The optional services the app has switched on, each of which is a page in `pages`. */
  features: readonly Feature[]
  /**
   * The app's own pages: the top-level ones (no `under`) are the navigation bar on every page of the app (`AppNav`, at most five); `icon` is
   * a meaning of the design system's `ICONS`, and `description` says what is on the page, one line. A page with `under` (the path of
   * another page) is a subpage: the page it is under lists it (`AppSubPages`) and the breadcrumbs go through it.
   */
  pages: readonly { to: string; label: string; icon: IconName; description: string; under?: string }[]
}

export const APPS = {
  music: {
    label: "Musikk",
    icon: Music,
    description: "Musikken jeg hører på, og hva jeg hørte på denne dagen.",
    href: "https://sky.lmfaole.party/apps/medier/musikk/",
    devPort: 5176,
    group: "media",
    features: ["library"],
    pages: [
      { to: "/", label: "Oversikt", icon: "home", description: "Siste avspillinger og hva du kan utforske." },
      { to: "/tilbakeblikk", label: "Tilbakeblikk", icon: "history", description: "Se tilbake på det jeg har hørt, uke for uke, måned for måned og år for år." },
      { to: "/tilbakeblikk/uke", label: "Uke for uke", icon: "calendar", description: "Hvor mye jeg har hørt hver uke, og hva som endret seg.", under: "/tilbakeblikk" },
      { to: "/tilbakeblikk/maaned", label: "Måned for måned", icon: "calendar", description: "Hvor mye jeg har hørt hver måned, og hva som endret seg.", under: "/tilbakeblikk" },
      { to: "/tilbakeblikk/aar", label: "År for år", icon: "calendar", description: "Hvor mye jeg har hørt hvert år, og hva som endret seg.", under: "/tilbakeblikk" },
      { to: "/historikk", label: "Historikk", icon: "time", description: "Hver avspilling, en måned om gangen, nyeste først." },
      { to: "/bibliotek", label: "Bibliotek", icon: "folder", description: "Alle artister, album og låter jeg har hørt, med søk og filter." },
      { to: "/konserter", label: "Konserter", icon: "people", description: "Konsertene jeg skal på og har vært på, med bildene fra dem." },
      { to: "/konserter/venuer", label: "Venuer", icon: "place", description: "Stedene jeg har vært på konsert, de jeg har vært oftest på først.", under: "/konserter" },
    ],
  },
  podkast: {
    label: "Podkast",
    icon: Podcast,
    description: "Podkastene jeg hører på, med hele lyttehistorikken fra Spotify, scrobblene og telefonen.",
    href: "https://sky.lmfaole.party/apps/medier/podkast/",
    devPort: 5186,
    group: "media",
    features: [],
    pages: [
      { to: "/", label: "Oversikt", icon: "home", description: "Hva du har hørt på, og når." },
      { to: "/historikk", label: "Historikk", icon: "time", description: "Alt jeg har spilt, fra Spotify, scrobblene og telefonen, nyeste først." },
    ],
  },
  film: {
    label: "Film",
    icon: Clapperboard,
    description: "Filmene jeg har sett, med fakta fra TMDB.",
    href: "https://sky.lmfaole.party/apps/medier/film/",
    devPort: 5188,
    group: "media",
    features: [],
    pages: [
      { to: "/", label: "Oversikt", icon: "home", description: "Hva du har sett, og når." },
      { to: "/historikk", label: "Historikk", icon: "time", description: "Hver film du har sett, nyeste først, med dag, vurdering og sted." },
      { to: "/kinoer", label: "Kinoer", icon: "place", description: "Kinoene jeg har vært på, de jeg har vært oftest på først." },
    ],
  },
  tv: {
    label: "TV-serier",
    icon: Tv,
    description: "TV-seriene jeg har sett, episode for episode, med fakta fra TMDB.",
    href: "https://sky.lmfaole.party/apps/medier/tv/",
    devPort: 5190,
    group: "media",
    features: [],
    pages: [
      { to: "/", label: "Oversikt", icon: "home", description: "Hvilke episoder du har sett, og når." },
      { to: "/historikk", label: "Historikk", icon: "time", description: "Hver episode du har sett, nyeste først, med dag og sted." },
    ],
  },
  games: {
    label: "Spill",
    icon: Gamepad2,
    description: "Spillene jeg har spilt, med timer fra Steam og fakta fra IGDB.",
    href: "https://sky.lmfaole.party/apps/medier/spill/",
    devPort: 5192,
    group: "media",
    features: ["library"],
    pages: [
      { to: "/", label: "Oversikt", icon: "home", description: "Hva du har spilt, og hvor lenge." },
      { to: "/historikk", label: "Historikk", icon: "time", description: "Hver linje i loggen, en måned om gangen, nyeste først." },
      { to: "/bibliotek", label: "Bibliotek", icon: "folder", description: "Alle spill jeg har spilt, eier eller ønsker meg, med søk, rekkefølge og status." },
    ],
  },
  books: {
    label: "Bøker",
    icon: BookOpen,
    description: "Bøkene jeg har lest, fra Hardcover og loggen min, med fakta fra Open Library.",
    href: "https://sky.lmfaole.party/apps/medier/boker/",
    devPort: 5194,
    group: "media",
    features: ["library"],
    pages: [
      { to: "/", label: "Oversikt", icon: "home", description: "Hva du har lest, og når." },
      { to: "/historikk", label: "Historikk", icon: "time", description: "Hver linje i loggen, en måned om gangen, nyeste først." },
      { to: "/bibliotek", label: "Bibliotek", icon: "folder", description: "Alle bøker jeg har lest, eier eller vil lese, med søk, rekkefølge og status." },
    ],
  },
  boardgames: {
    label: "Brettspill",
    icon: Dices,
    description: "Brettspillene jeg har spilt, med fakta fra BoardGameGeek.",
    href: "https://sky.lmfaole.party/apps/medier/brettspill/",
    devPort: 5196,
    group: "media",
    features: ["library"],
    pages: [
      { to: "/", label: "Oversikt", icon: "home", description: "Hvilke brettspill du har spilt." },
      { to: "/historikk", label: "Historikk", icon: "time", description: "Hver linje i loggen, en måned om gangen, nyeste først." },
      { to: "/bibliotek", label: "Bibliotek", icon: "folder", description: "Alle brettspill jeg har spilt, eier eller ønsker meg, med søk, rekkefølge og vurdering." },
    ],
  },
} as const satisfies Record<AppId, AppDetails>

/**
 * The home apps (innboks, hjem, penger, rss): the owner's own UIs on the home server, moved here from the hjemmeserver app of
 * Nextcloud (`docs/HOME-APPS-MIGRATION.md`). They keep the addresses the installed PWAs have (`/apps/hjemmeserver/<id>/`, so scope and
 * identity stay), are mounted by the media server next to the media apps (`scripts/media-registry.ts`, `HOME_APPS`) and are not in
 * `APP_IDS`: a media app's tests, the hub's list and its manifest shortcuts are about the media apps. `miniflux` is the id of the RSS app (its
 * address and its Nextcloud app id), whose name is «RSS».
 */
export const HOME_APP_IDS = ["innboks", "hjem", "miniflux", "penger"] as const

/** The id of one home app, e.g. "penger". */
export type HomeAppId = (typeof HOME_APP_IDS)[number]

/** Any app of the registry: a media app or a home app. */
export type AnyAppId = AppId | HomeAppId

/** A home app adds its colour's hue: `--app-<id>` of `theme.css` is `oklch(0.5 0.14 <hue>)` (`oklch(0.78 0.12 <hue>)` in the dark theme), from `APP_HUES` of the Nextcloud repository's `scripts/design-tokens.ts`. */
interface HomeAppDetails extends AppDetails {
  hue: number
}

export const HOME_APPS = {
  innboks: {
    label: "Innboks",
    icon: Inbox,
    description: "Del filer til din egen Nextcloud.",
    href: "https://sky.lmfaole.party/apps/hjemmeserver/innboks/",
    devPort: 5202,
    group: "home",
    features: [],
    hue: 275,
    pages: [
      { to: "/", label: "Innboks", icon: "inbox", description: "Del filer til din egen Nextcloud." },
      { to: "/hjelp", label: "Hjelp", icon: "question", description: "Hva Innboks kan gjøre: mål, arkiver, store filer og dårlig nett." },
    ],
  },
  hjem: {
    label: "Hjem",
    icon: HousePlug,
    description: "Status, AdGuard og nettet hjemme.",
    href: "https://sky.lmfaole.party/apps/hjemmeserver/hjem/",
    devPort: 5204,
    group: "home",
    features: [],
    hue: 230,
    pages: [
      { to: "/", label: "Oversikt", icon: "home", description: "Hva som er i orden hjemme, og veien videre." },
      { to: "/status", label: "Status", icon: "info", description: "Hva Uptime Kuma og systemet sier om maskinen." },
      { to: "/status/maskin", label: "Maskin", icon: "server", description: "Disk, minne, last og oppetid.", under: "/status" },
      { to: "/status/drift", label: "Drift", icon: "settings", description: "Containere, sikkerhetskopi og oppdatering.", under: "/status" },
      { to: "/adguard", label: "AdGuard", icon: "shield", description: "Hva AdGuard Home har svart på, og hva som er blokkert." },
      { to: "/adguard/enheter", label: "Enheter", icon: "device", description: "Hvilke enheter som har gjort oppslag det siste døgnet.", under: "/adguard" },
      { to: "/adguard/historikk", label: "Historikk", icon: "time", description: "Spørringer og blokkeringer dag for dag.", under: "/adguard" },
      { to: "/adguard/drift", label: "Drift", icon: "settings", description: "Om beskyttelsen er på, DNS-tjenerne, blokkeringslistene og hurtigbufferen.", under: "/adguard" },
      { to: "/nett", label: "Nettet", icon: "link", description: "Hvordan nettet hjemme har det." },
      { to: "/nett/hastighet", label: "Hastighet", icon: "speed", description: "Internetthastighet målt hver time.", under: "/nett" },
      { to: "/nett/kvalitet", label: "Kvalitet", icon: "chart-line", description: "Pakketap, utfall og offentlig adresse, målt hvert minutt.", under: "/nett" },
    ],
  },
  miniflux: {
    label: "RSS",
    icon: Rss,
    description: "Dagens briefing og loggen fra Miniflux.",
    href: "https://sky.lmfaole.party/apps/hjemmeserver/miniflux/",
    devPort: 5206,
    group: "home",
    features: [],
    hue: 45,
    pages: [
      { to: "/", label: "Briefing", icon: "home", description: "De ti største sakene siste døgn." },
      { to: "/logg", label: "Fullstendig logg", icon: "time", description: "Alle sakene, en måned om gangen." },
      { to: "/kilder", label: "Kilder", icon: "feed", description: "Alle kildene og hvor mye hver av dem veier." },
      { to: "/folger", label: "Fulgte saker", icon: "bookmark", description: "Sakene du følger, og varsler når det kommer nye artikler." },
      { to: "/sok", label: "Søk", icon: "search", description: "Søk i tittel, kilde og kategori for alle sakene i loggen." },
    ],
  },
  penger: {
    label: "Penger",
    icon: Wallet,
    description: "Abonnementer og økonomi.",
    href: "https://sky.lmfaole.party/apps/hjemmeserver/penger/",
    devPort: 5208,
    group: "home",
    features: [],
    hue: 165,
    pages: [
      { to: "/", label: "Oversikt", icon: "home", description: "Hva abonnementene koster per måned, og de som løper nå." },
      { to: "/aktive", label: "Aktive abonnement", icon: "subscription", description: "Abonnementene som løper nå." },
      { to: "/avsluttede", label: "Avsluttede abonnement", icon: "cancelled", description: "Abonnementene som er sagt opp." },
    ],
  },
} as const satisfies Record<HomeAppId, HomeAppDetails>

/** Every app of either kind by id: what the page chrome (the menu, the breadcrumbs, the marks) looks an app up in. */
export const ANY_APPS = { ...APPS, ...HOME_APPS } as const satisfies Record<AnyAppId, AppDetails>

export type AppEntry = AppDetails & { id: AnyAppId }

/** A media app with its id: what `listApps` returns. */
export type MediaAppEntry = AppDetails & { id: AppId }

/** One of an app's pages, with the optional `under` of a subpage. */
export type AppPageEntry = AppDetails["pages"][number]

/** Every app, in registry order. */
export function listApps(): MediaAppEntry[] {
  return APP_IDS.map((id) => ({ id, ...APPS[id] }))
}

/** The four home apps, in registry order. */
export function listHomeApps(): AppEntry[] {
  return HOME_APP_IDS.map((id) => ({ id, ...HOME_APPS[id] }))
}

/** Every app of one group, in registry order: what `forside`'s page for the group lists. */
export function appsInGroup(group: AppGroup): AppEntry[] {
  return [...listApps(), ...listHomeApps()].filter((app) => app.group === group)
}

/** One app's pages, with their literal paths kept for the page's links to check. */
export function appPages<Id extends AnyAppId>(id: Id): (typeof ANY_APPS)[Id]["pages"] {
  return ANY_APPS[id].pages
}

/** Whether a string names an app of the registry (`music`, `hjem`). */
export function isAnyApp(id: string): id is AnyAppId {
  return Object.hasOwn(ANY_APPS, id)
}

/** The top-level pages of an app: its navigation bar, in registry order (the front page first). */
export function appTopPages(id: AnyAppId): readonly AppPageEntry[] {
  const pages: readonly AppPageEntry[] = ANY_APPS[id].pages
  return pages.filter((page) => page.under === undefined)
}

/** The pages directly under a page of the app (`to` is its path in the registry, `/tilbakeblikk`): what that page lists. */
export function appSubPages(id: AnyAppId, to: string): readonly AppPageEntry[] {
  const pages: readonly AppPageEntry[] = ANY_APPS[id].pages
  return pages.filter((page) => page.under === to)
}

/** What the menu of an app's pages is called to a screen reader: «Sider i musikk», «Sider i TV-serier», «Sider i RSS». */
export function appNavLabel(id: AnyAppId): string {
  return `Sider i ${ANY_APPS[id].label.replace(/^(?!TV|RSS)./, (first) => first.toLowerCase())}`
}

/** Where an app is mounted on its host, without a trailing slash (`/apps/medier/film`, `/apps/hjemmeserver/penger`): the base, the Worker's routes and the manifest's scope all follow it. */
export function appMountPath(id: AnyAppId): string {
  return new URL(ANY_APPS[id].href).pathname.replace(/\/+$/, "")
}

/** Whether `id` is a home app: it has no hub above it, and its front page lists the other home apps and the media hub (`AppSwitcher`). */
export function isHomeApp(id: AnyAppId): id is HomeAppId {
  return HOME_APP_IDS.some((home) => home === id)
}

/** A page of another app: a full URL under that app's address, since each app is its own deployment. */
export function pageHref(origin: string, to: string): string {
  return new URL(to.replace(/^\//, ""), origin.endsWith("/") ? origin : `${origin}/`).href
}

/**
 * Where a link to `app` goes. `import.meta.env.DEV` is resolved per app at
 * build time, so it is true only inside the app running under `vite dev`: a
 * link to another app must then point at that app's own local port, which is
 * only reachable by port, not by subdomain.
 */
export function appOrigin(app: AppEntry): string {
  return import.meta.env?.DEV ? `http://localhost:${app.devPort}${new URL(app.href).pathname}` : app.href
}
