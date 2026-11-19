/**
 * The uploaded preview images the pages name, for a Worker to allow on its
 * `/og/` route. Reads `og-pages.json` only: `og-pages.ts` also knows the apps
 * (and their icons), which a Worker has no use for.
 */

import rows from "./og-pages.json" with { type: "json" }

/** The asset ids of every uploaded preview image. */
export function ogImageIds(): Set<string> {
  return new Set(rows.flatMap((row) => ("image" in row && typeof row.image === "string" ? [row.image] : [])))
}

