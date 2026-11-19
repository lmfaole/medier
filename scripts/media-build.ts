/**
 * `npm run media:build`: builds the eight media apps and each home app that has code (`SERVED_APPS`) for `media-server.ts`, all at once (each build is a few seconds and
 * well under a gigabyte), after removing the `web/public/api/` a snapshot may have left behind: the server answers
 * `/api/*` from the databases, so those files would only be copied into `dist/client` and served stale by nobody.
 * Restart the server afterwards; it loads a build when the first page of the app is asked for.
 */

import { rmSync } from "node:fs"
import { join } from "node:path"

import { SERVED_APPS } from "./apps.ts"
import { runParallel } from "./run-parallel.ts"

const root = join(import.meta.dirname, "..")

export const buildCommand = (app: string): string => `npm run -s build --workspace apps/${app}/web`

if (import.meta.filename === process.argv[1]) {
  for (const app of SERVED_APPS) rmSync(join(root, "apps", app, "web", "public", "api"), { recursive: true, force: true })
  const started = Date.now()
  const results = await runParallel(SERVED_APPS.map(buildCommand))
  const failed = results.filter((result) => result.code !== 0)
  for (const result of failed) console.error(`\n== ${result.command} (exit ${result.code})\n${result.output.trimEnd()}`)
  console.log(`media:build: ${SERVED_APPS.length - failed.length}/${SERVED_APPS.length} apps built in ${((Date.now() - started) / 1000).toFixed(1)} s${failed.length > 0 ? `; failed: ${failed.map((result) => result.command).join(", ")}` : ""}`)
  process.exitCode = failed.length > 0 ? 1 : 0
}
