// How what the owner has is written on a work's page: the format as the collection writes it (`cd`, `vinyl`, `digital`,
// free text, lowercase, several separated by commas) in words.

/** One line of the collection as a page tells it: the owner's note stays in the database. */
export interface CollectionLine {
  status: 'owned' | 'want'
  format: string | null
  /** The day the line was added (`YYYY-MM-DD`), or none when it is not known. */
  addedOn: string | null
  rating: number | null
}

/** How the owner stands to a work and in what form: `owned` when any line of the collection says so, and the lines themselves. */
export interface Ownership {
  status: 'owned' | 'want'
  format: string | null
  lines: CollectionLine[]
}

/** The ownership the collection's lines for one work add up to, or none where the collection has none. */
export function ownershipOf(lines: readonly CollectionLine[]): Ownership | null {
  if (lines.length === 0) return null
  const owned = lines.filter((line) => line.status === 'owned')
  const told = (owned.length > 0 ? owned : lines).flatMap((line) => (line.format === null ? [] : line.format.split(',').map((name) => name.trim())))
  return { status: owned.length > 0 ? 'owned' : 'want', format: told.length === 0 ? null : [...new Set(told)].join(', '), lines: lines.map(({ status, format, addedOn, rating }) => ({ status, format, addedOn, rating })) }
}

/** The rating the collection gives a work, the last line that has one: for a work that was never seen, heard or played. */
export function ownershipRating(ownership: Ownership | null): number | null {
  return ownership?.lines.findLast((line) => line.rating !== null)?.rating ?? null
}
/** The words for the formats the collection has been seen to use: an unknown one is shown with a capital, as it was written. */
export const FORMAT_LABELS: Readonly<Record<string, string>> = {
  cd: 'CD',
  vinyl: 'Vinyl',
  kassett: 'Kassett',
  digital: 'Digitalt',
  steam: 'Steam',
  xbox: 'Xbox',
  playstation: 'PlayStation',
  fysisk: 'Fysisk',
  dvd: 'DVD',
  'blu-ray': 'Blu-ray',
  '4k': '4K UHD',
  bok: 'Bok',
  ebok: 'E-bok',
  lydbok: 'Lydbok',
}

/** `cd, vinyl` as words: each name by the table, an unknown one with a capital, none for no format. */
export function formatLabel(format: string | null): string | null {
  const names = (format ?? '').split(',').map((name) => name.trim()).filter((name) => name !== '')
  if (names.length === 0) return null
  return names.map((name) => FORMAT_LABELS[name] ?? name.charAt(0).toLocaleUpperCase('nb-NO') + name.slice(1)).join(', ')
}

/** How many copies the owner has: one per owned line, so a second copy is a second line. */
export function copiesOf(ownership: Ownership): number {
  return ownership.lines.filter((line) => line.status === 'owned').length
}

/** The value of an «Eier» tile: each format with the copies of it (`Xbox, PlayStation ×2`), `Ja` where it is owned and no format is told (with the copies, if several), `Nei, ønsker meg` for a want. */
export function ownershipValue(ownership: Ownership): string {
  if (ownership.status === 'want') return 'Nei, ønsker meg'
  const counts = new Map<string, number>()
  for (const line of ownership.lines) {
    if (line.status !== 'owned') continue
    for (const name of (line.format ?? '').split(',').map((part) => part.trim()).filter((part) => part !== '')) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const copies = copiesOf(ownership)
  if (counts.size === 0) return copies > 1 ? `Ja, ${copies} eksemplarer` : 'Ja'
  return [...counts].map(([name, count]) => `${formatLabel(name)}${count > 1 ? ` ×${count}` : ''}`).join(', ')
}
