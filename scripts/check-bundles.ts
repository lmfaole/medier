/**
 * Fails when a production bundle contains the devtools. Astro's dev toolbar is added
 * only by `astro dev`, so a build should not carry it; this
 * is the check that it did, over the client assets and the Worker in `dist/server`
 * of every app. Run after `npm run build`.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { APPS } from "./apps.ts"

/**
 * Strings the dev toolbar puts in a bundle and nothing else does. Redo the search when Astro is
 * updated: a string that changed would make this check pass for the wrong reason.
 */
export const DEVTOOLS_MARKERS: readonly string[] = [
  // Astro's dev toolbar, which `astro dev` adds to a page and a build must not carry (read from astro's runtime/client/dev-toolbar, 2026-11-04).
  "astro-dev-toolbar",
]

/** The paths of the files whose text contains any marker. */
export function filesWithDevtools(files: ReadonlyMap<string, string>, markers: readonly string[] = DEVTOOLS_MARKERS): string[] {
  return [...files].filter(([, text]) => markers.some((marker) => text.includes(marker))).map(([path]) => path)
}

/** Every built `.js` and `.mjs` file under `dist`, keyed by its path from `dist`. */
export function readDistFiles(dist: string): Map<string, string> {
  const files = new Map<string, string>()
  for (const relative of readdirSync(dist, { recursive: true, encoding: "utf8" })) {
    if (/\.m?js$/.test(relative)) files.set(relative.replaceAll("\\", "/"), readFileSync(join(dist, relative), "utf8"))
  }
  return files
}

/**
 * The halves of a build with no script in them: the page is `client/`, the
 * Worker is `server/`. A scan that read only one of them would say "clean" about
 * the other without having looked.
 */
export function halvesWithoutFiles(files: ReadonlyMap<string, string>, halves: readonly string[] = ["client", "server"]): string[] {
  return halves.filter((half) => ![...files.keys()].some((path) => path.startsWith(`${half}/`)))
}

if (import.meta.filename === process.argv[1]) {
  const root = join(import.meta.dirname, "..")
  const problems: string[] = []
  let scanned = 0
  for (const { name } of APPS.filter((app) => app.port !== undefined)) {
    const dist = join(root, "apps", name, "web", "dist")
    if (!existsSync(dist)) {
      problems.push(`${name}: no web/dist; run \`npm run build\` first`)
      continue
    }
    const files = readDistFiles(dist)
    scanned += files.size
    for (const half of halvesWithoutFiles(files)) problems.push(`${name}: no built ${half} files, so ${half === "server" ? "the Worker" : "the page"} was not scanned`)
    for (const path of filesWithDevtools(files)) problems.push(`${name}: devtools are in a production bundle: apps/${name}/web/dist/${path}`)
  }
  if (problems.length > 0) {
    console.error(`check-bundles:\n${problems.map((problem) => `  ${problem}`).join("\n")}`)
    process.exitCode = 1
  } else {
    console.log(`check-bundles: ${scanned} built files in ${APPS.length} apps, no devtools`)
  }
}
