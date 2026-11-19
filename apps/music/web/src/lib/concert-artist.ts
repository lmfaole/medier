/** The separators a ticket seller puts between the artist and the name of the tour or the night: «Zara Larsson - Midnight Sun 2025 Tour», «Oslo World: Pumpegris». */
const SEPARATORS = [' - ', ' – ', ': ']

/** The texts of a concert title that may be an artist's name: the whole title and each side of a separator, lowercase. */
export function candidatesOf(title: string): string[] {
  const texts = [title, ...SEPARATORS.flatMap((separator) => title.split(separator).slice(0, 2).length === 2 ? [title.split(separator)[0] ?? '', title.slice(title.indexOf(separator) + separator.length)] : [])]
  return [...new Set(texts.map((text) => text.trim().toLowerCase()).filter((text) => text !== ''))]
}

/** The artist a concert title is named for: the whole title, or a side of a separator, when it is exactly an artist's name (`artists`: lowercase name to name). */
export function artistOf(title: string, artists: ReadonlyMap<string, string>): string | null {
  for (const text of candidatesOf(title)) {
    const name = artists.get(text)
    if (name !== undefined) return name
  }
  return null
}
