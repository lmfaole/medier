/**
 * What settling a film in `.data/film-log.csv` changes, as a pure function: the year and TMDB's number written on the line
 * of a viewing that TMDB could not match by its title (a ticket mail's title is not always the register's). A line that
 * already has them is left alone, and a line with another number is refused, never overwritten.
 */

export interface Settle {
  day: string
  title: string
  year: number
  tmdbId: number
}

export interface Settled {
  text: string
  changed: string[]
  already: string[]
  /** Fixes with no line, or a line this cannot rewrite safely. */
  refused: string[]
}

const COLUMNS = 8
const YEAR = 2
const TMDB_ID = 6

export function settleLog(text: string, fixes: readonly Settle[]): Settled {
  const lines = text.split("\n")
  const result: Settled = { text, changed: [], already: [], refused: [] }
  for (const fix of fixes) {
    const label = `${fix.day} ${fix.title}`
    const at = lines.findIndex((line) => {
      const [day, title] = line.replaceAll('"', "").split(",")
      return day === fix.day && title === fix.title
    })
    const line = lines[at]
    if (line === undefined || line.includes('"')) {
      result.refused.push(`${label}: no plain line for it`)
      continue
    }
    const fields = line.split(",")
    while (fields.length < COLUMNS) fields.push("")
    if (fields[TMDB_ID] === String(fix.tmdbId)) {
      result.already.push(label)
      continue
    }
    if (fields[TMDB_ID] !== "") {
      result.refused.push(`${label}: already settled as ${fields[TMDB_ID]}`)
      continue
    }
    fields[YEAR] = String(fix.year)
    fields[TMDB_ID] = String(fix.tmdbId)
    lines[at] = fields.join(",")
    result.changed.push(label)
  }
  result.text = lines.join("\n")
  return result
}

export interface Removed {
  text: string
  /** The log line that was removed, or what stopped it. */
  outcome: { removed: string } | { refused: string }
}

/** Removes the one line of a viewing by its day (empty for an undated line) and title; no line or several is refused. */
export function removeLine(text: string, day: string, title: string): Removed {
  const lines = text.split("\n")
  const at = lines.flatMap((line, index) => {
    const [lineDay, lineTitle] = line.replaceAll('"', "").split(",")
    return !line.startsWith("#") && lineDay === day && lineTitle === title ? [index] : []
  })
  const [only] = at
  if (only === undefined) return { text, outcome: { refused: `no line for ${day === "" ? "an undated" : day} ${title}` } }
  if (at.length > 1) return { text, outcome: { refused: `${at.length} lines for ${day === "" ? "an undated" : day} ${title}: remove the right one by hand` } }
  const removed = lines[only] ?? ""
  return { text: lines.filter((_, index) => index !== only).join("\n"), outcome: { removed } }
}
