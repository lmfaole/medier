/**
 * The first-visit help of the site: the intros of the pages, the «Nytt» on Historikk and the offer to install, each remembered in the design system's `seen` cookie
 * (`@lmfaole/designsystem/lib/onboarding`) under the whole site. Raise an intro's version to show a changed one again.
 */
export const SEEN_PATH = "/"

/** Historikk is new until this day (six weeks from when it came), and not once it has been opened. */
export const NEW_HISTORIKK = { id: "new-historikk", until: "2027-01-01T00:00:00+01:00" } as const

export interface Intro {
  id: string
  version?: number
  title: string
  body: string
}

export const INTROS = {
  historikk: {
    id: "intro-historikk",
    title: "Alt på én tidslinje",
    body: "Avspillinger og det du har sett ligger sammen, nyeste først. Øktene øverst viser hvor lenge du lyttet eller så, og avspillinger med under 30 minutters mellomrom blir regnet som én økt.",
  },
  musikk: {
    id: "intro-musikk",
    title: "Musikken din fra Last.fm",
    body: "Her er de siste avspillingene og artistene du har spilt mest den siste måneden. Trykk på en artist, et album eller en låt for å se mer.",
  },
  film: {
    id: "intro-film-og-tv",
    title: "Det du har sett, fra Trakt",
    body: "Filmer og serier du har markert som sett på Trakt, med plakat og handling fra TMDB. Trykk på en tittel for å se hvem som var med.",
  },
} as const satisfies Record<string, Intro>
