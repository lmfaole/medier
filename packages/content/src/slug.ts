/** Ids that nobody types are made from a text. Its own module, so the collection specs can use it without importing the mapping that imports them. */

/** An ASCII slug of a text: «Høyskolen Kristiania» is `hoyskolen-kristiania`. For the ids nobody types. */
export function slugify(text: string): string {
  return text
    .replace(/[øØ]/g, "o")
    .replace(/[åÅ]/g, "a")
    .replace(/[æÆ]/g, "ae")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}
