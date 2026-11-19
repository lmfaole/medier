// One viewing as the film log writes it. `scripts/film-inbox-plan.ts` checks every answer of the Forms inbox with it; the
// rules are those of `shared_data::watch_log`, which has the last word.
import * as v from "valibot"

const text = (max: number) =>
  v.pipe(
    v.string(),
    v.transform((value) => value.replace(/\s+/g, " ").trim()),
    v.maxLength(max),
  )

const isRealDay = (value: string): boolean => {
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
}

export const FilmLogEntrySchema = v.object({
  watchedOn: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/), v.check(isRealDay)),
  title: v.pipe(text(200), v.minLength(1)),
  year: v.pipe(
    v.string(),
    v.trim(),
    v.regex(/^(\d{4})?$/),
    v.transform((value) => (value === "" ? null : Number(value))),
    v.check((value) => value === null || (value >= 1888 && value <= 2100)),
  ),
  rating: v.pipe(
    v.string(),
    v.trim(),
    v.transform((value) => (value === "" ? null : Number(value.replace(",", ".")))),
    v.check((value) => value === null || (value >= 0.5 && value <= 5 && (value * 2) % 1 === 0)),
  ),
  note: text(500),
  cinema: text(100),
})

export type FilmLogEntry = v.InferOutput<typeof FilmLogEntrySchema>

export type FilmLogEntryInput = v.InferInput<typeof FilmLogEntrySchema>

/** The entry the fields make, or null when any rule is broken. */
export function readFilmLogEntry(input: FilmLogEntryInput): FilmLogEntry | null {
  const result = v.safeParse(FilmLogEntrySchema, input)
  return result.success ? result.output : null
}

// The csv writer of the Rust importer quotes exactly these.
const quoted = (field: string): string => (/[",\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field)

/** The line the log gets, without a newline: `rewatch` and `tmdb_id` stay empty, the machine settles them. */
export function filmLogLine(entry: FilmLogEntry): string {
  const fields = [entry.watchedOn, entry.title, entry.year === null ? "" : String(entry.year), entry.rating === null ? "" : String(entry.rating), "", entry.note, "", entry.cinema]
  return fields.map(quoted).join(",")
}

/** The fields of one csv line, or null for an unclosed quote. */
export function splitFilmLogRecord(line: string): string[] | null {
  const fields: string[] = []
  let current = ""
  let inQuotes = false
  for (let index = 0; index < line.length; index++) {
    const char = line.charAt(index)
    if (inQuotes) {
      if (char !== '"') current += char
      else if (line.charAt(index + 1) === '"') {
        current += '"'
        index++
      } else inQuotes = false
    } else if (char === '"' && current === "") inQuotes = true
    else if (char === ",") {
      fields.push(current)
      current = ""
    }
    else current += char
  }
  if (inQuotes) return null
  fields.push(current)
  return fields
}

/** What makes two lines the same viewing: the day and the title, as the machine's ticket mail also counts it. */
export function filmLogKey(line: string): string | null {
  const fields = splitFilmLogRecord(line)
  const [watchedOn, title] = fields ?? []
  return watchedOn === undefined || title === undefined || watchedOn.startsWith("#") ? null : `${watchedOn}|${title.trim().toLowerCase()}`
}
