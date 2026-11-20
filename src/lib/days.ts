/** Calendar dates (`YYYY-MM-DD`, no time of day): written out, and counted in years. Pure, with no time zone to move a date. */

const LONG_DAY = new Intl.DateTimeFormat("nb-NO", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })

/** A calendar date (`YYYY-MM-DD`, no time of day) as «25. april 1940»: in UTC, so no time zone moves it a day. */
export function longDay(date: string): string {
  return LONG_DAY.format(new Date(`${date}T12:00:00Z`))
}

/** How old a person is (or was when they died) on the day, in whole years, from two calendar dates. */
export function ageOn(born: string, until: string): number | null {
  const [by, bm, bd] = born.split("-").map(Number)
  const [uy, um, ud] = until.split("-").map(Number)
  if (by === undefined || bm === undefined || bd === undefined || uy === undefined || um === undefined || ud === undefined) return null
  const years = uy - by - (um < bm || (um === bm && ud < bd) ? 1 : 0)
  return years >= 0 ? years : null
}
