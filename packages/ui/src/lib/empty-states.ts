// What a page says when it has nothing to show, once, so the same absence reads the same in every app. A page where the
// whole log is empty has words of its own (`WatchWords.front.empty`): it names what the app is about.

/** Nothing has been registered at all. */
export const NOTHING_YET = 'Ingenting ennå.'

/** A time frame (`?period=`) with no entries. */
export const NOTHING_IN_PERIOD = 'Ingenting i denne perioden.'

/** A month (`?month=`) with no entries. */
export const NOTHING_IN_MONTH = 'Ingenting denne måneden.'

/** A year (`?year=`) with no entries. */
export const NOTHING_IN_YEAR = 'Ingenting dette året.'

/** A search or a filter that matches nothing. */
export const NOTHING_FOUND = 'Ingenting passer med søket.'

/** A week, a month or a year in which nothing was played. */
export const NOTHING_PLAYED = 'Ingenting ble spilt.'

/** The empty state of a period (a month or a year) of a history. */
export const NOTHING_IN_KIND = { month: NOTHING_IN_MONTH, year: NOTHING_IN_YEAR } as const

/** The mail scan has not written its file yet (a home app reading `Apper/*.json`): said where the page would show the figures. */
export const NO_SCAN_YET = 'Ingen skanning enda. Kjør «npm run abonnement:scan».'

/** A list of subscriptions with none of that kind, by status. */
export const NO_SUBSCRIPTIONS = { aktiv: 'Ingen aktive abonnement.', avsluttet: 'Ingen avsluttede abonnement.' } as const
