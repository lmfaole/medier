/**
 * The first-visit help of the site: the intros of the pages and the offer to install, each remembered in the design system's `seen` cookie (`@lmfaole/designsystem/lib/onboarding`) under the whole
 * site. Raise an intro's version to show a changed one again.
 */
export const SEEN_PATH = "/"

export interface Intro {
  id: string
  version?: number
  title: string
  body: string
}

export const INTROS = {
  musikk: {
    id: "intro-musikk",
    version: 2,
    title: "Musikken din fra Last.fm",
    body: "Her er de siste avspillingene og artistene du har spilt mest den siste måneden. Historikken og oppsummeringen av hver uke og måned finner du øverst. Trykk på en artist, et album eller en låt for å se mer.",
  },
  musikkHistorikk: {
    id: "intro-musikk-historikk",
    title: "Alt du har hørt på, dag for dag",
    body: "Avspillingene fra Last.fm, nyeste først. Øktene øverst viser hvor lenge du lyttet: avspillinger med under 30 minutters mellomrom blir regnet som én økt.",
  },
  film: {
    id: "intro-film-og-tv",
    version: 2,
    title: "Det du har sett, fra Trakt",
    body: "Filmer og serier du har markert som sett på Trakt, med plakat og handling fra TMDB. Historikken og oppsummeringen av hver uke og måned finner du øverst. Trykk på en tittel for å se hvem som var med.",
  },
  filmHistorikk: {
    id: "intro-film-historikk",
    title: "Alt du har sett, dag for dag",
    body: "Filmene og episodene fra Trakt, nyeste først. Øktene øverst viser hvor lenge du så: en film regnes med lengden sin, en episode som 45 minutter, og det som er sett med under 30 minutters mellomrom blir én økt.",
  },
} as const satisfies Record<string, Intro>
