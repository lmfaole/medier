/** A small iCalendar reader: the events of an `.ics` file with the fields a script needs, local days as written. */

export interface IcsEvent {
  uid: string
  summary: string
  location: string
  description: string
  /** `YYYY-MM-DD`, as the calendar wrote it (Europe/Oslo for the owner's calendars). */
  day: string
  /** `HH:MM`, or empty for an all-day event. */
  time: string
}

/** Lines folded at 75 characters continue on a line that starts with a space or a tab. */
const unfold = (text: string): string[] => text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/)

const unescapeText = (value: string): string => value.replace(/\\([nN,;\\])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c))

const dayOf = (stamp: string): { day: string; time: string } | undefined => {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/.exec(stamp)
  if (match === null) return undefined
  const [, year, month, day, hour, minute] = match
  return { day: `${year}-${month}-${day}`, time: hour === undefined ? "" : `${hour}:${minute}` }
}

/** A UTC stamp (`…Z`) as the Oslo day and time; other stamps are already local. */
const localStamp = (value: string): { day: string; time: string } | undefined => {
  if (!value.endsWith("Z")) return dayOf(value)
  const utc = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value)
  if (utc === null) return dayOf(value)
  const date = new Date(Date.UTC(Number(utc[1]), Number(utc[2]) - 1, Number(utc[3]), Number(utc[4]), Number(utc[5]), Number(utc[6])))
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo", dateStyle: "short", timeStyle: "short" }).format(date)
  return { day: parts.slice(0, 10), time: parts.slice(11, 16) }
}

/** Only `VEVENT`s count: the `VTIMEZONE` also has `DTSTART` lines. */
export function parseIcs(text: string): IcsEvent[] {
  const events: IcsEvent[] = []
  let current: Record<string, string> | undefined
  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") current = {}
    else if (line === "END:VEVENT") {
      const start = current === undefined ? undefined : localStamp(current["DTSTART"] ?? "")
      if (current !== undefined && start !== undefined) {
        events.push({
          uid: current["UID"] ?? "",
          summary: unescapeText(current["SUMMARY"] ?? ""),
          location: unescapeText(current["LOCATION"] ?? ""),
          description: unescapeText(current["DESCRIPTION"] ?? ""),
          ...start,
        })
      }
      current = undefined
    } else if (current !== undefined) {
      const colon = line.indexOf(":")
      if (colon > 0) current[line.slice(0, colon).split(";")[0] ?? ""] = line.slice(colon + 1)
    }
  }
  return events
}
