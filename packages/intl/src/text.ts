// Text helpers for pages of one thing each: the short key of a name, the same title spelled two ways, and a long text cut short.

/** A short text key, stable across runs: the letters of the text and an eight-digit hash of all of it, so two names that fold to the same letters stay two. */
export function slugOf(text: string): string {
  let hash = 0x811c9dc5
  for (const character of text) hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), 0x01000193) >>> 0
  const letters = text.replace(/[øØ]/g, 'o').replace(/[æÆ]/g, 'ae').replace(/ß/g, 'ss').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '')
  return `${letters === '' ? 'x' : letters}-${hash.toString(16).padStart(8, '0')}`
}

/** The letters and digits of a title, lowercase and without accents: a play's title and a feed's are the same where this is. */
export function normalizeTitle(text: string): string {
  return text.replace(/[øØ]/g, 'o').replace(/[æÆ]/g, 'ae').normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()
}

/** The first `limit` characters of a text, cut at a word and marked with «…», or the text as it is when it is shorter. */
export function excerpt(text: string, limit: number): string {
  if (text.length <= limit) return text
  const cut = text.slice(0, limit)
  const space = cut.lastIndexOf(' ')
  return `${cut.slice(0, space > limit / 2 ? space : limit).trimEnd()}…`
}

/** The text with its first letter a capital: a month's name at the start of a sentence. */
export function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase('nb-NO') + text.slice(1)
}

/** A work's title with its year in brackets where it has one: «Alien (1979)». The one way every list writes it. */
export function titleWithYear(title: string, year: number | string | null | undefined): string {
  return year === null || year === undefined || year === '' ? title : `${title} (${year})`
}
