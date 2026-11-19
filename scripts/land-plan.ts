/**
 * The decisions of `npm run land`, as pure functions: whether a source name and a date are acceptable, what a
 * landing does with each file (copy it, skip it because it is already there, or refuse because a different
 * file sits at the same place) and the manifest in the form `sha256sum -c` reads. The disk is `land.ts`'s.
 */

export const SOURCE = /^[a-z0-9][a-z0-9-]*$/
export const DATE = /^\d{4}-\d{2}-\d{2}$/

export interface Hashed {
  /** Path inside the dated folder, with `/` between parts. */
  path: string
  sha256: string
}

export interface LandingPlan {
  copy: string[]
  already: string[]
  /** Landed files that differ from what is being landed now: a landed original is never rewritten. */
  conflicts: string[]
}

export function planLanding(incoming: readonly Hashed[], landed: readonly Hashed[]): LandingPlan {
  const there = new Map(landed.map((file) => [file.path, file.sha256]))
  const plan: LandingPlan = { copy: [], already: [], conflicts: [] }
  for (const file of incoming) {
    const existing = there.get(file.path)
    if (existing === undefined) plan.copy.push(file.path)
    else if (existing === file.sha256) plan.already.push(file.path)
    else plan.conflicts.push(file.path)
  }
  return plan
}

/** `sha256sum` lines, paths starting with the dated folder, sorted so the same landing writes the same text. */
export function manifestText(date: string, files: readonly Hashed[]): string {
  return `${files
    .toSorted((a, b) => a.path.localeCompare(b.path))
    .map((file) => `${file.sha256}  ${date}/${file.path}`)
    .join("\n")}\n`
}

/** The command that imports a landed source, for the sources that have one; the folder is passed as given. */
export function importerFor(source: string, folder: string): string | undefined {
  if (source === "spotify") return `cd apps/music && cargo run -p music-sync -- import-spotify ${folder}`
  if (source === "lastfm") return `cd apps/music && cargo run -p music-sync -- import-lastfm ${folder}`
  if (source === "trueachievements") return `cd apps/games && cargo run -p games-sync -- xbox`
  if (source === "pokemon-go") return `cd apps/games && cargo run -p games-sync -- pokemon-go`
  if (source === "goodreads") return `cd apps/books && cargo run -p books-sync -- goodreads ${folder}`
  return undefined
}
