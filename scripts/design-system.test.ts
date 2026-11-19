/**
 * The design system's one hard rule: an app has no styling of its own. Everything a page looks like comes from a component
 * of `packages/ui` (or the shared pages of `packages/watch` and `packages/shelf`), so no file under `apps/<app>/web/src`
 * writes a class, an inline style or a stylesheet (`docs/UI-COMPONENTS.md`).
 *
 * `ALLOWED` is what was left when the rule came: the files that still style themselves and how many times. It may only
 * shrink. Moving a file's markup into the design system takes its line out; nothing is ever added.
 */

import { strict as assert } from "node:assert"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"
import { test } from "node:test"

import { sourceFiles } from "./source-files.ts"

const root = join(import.meta.dirname, "..")

/** A class or a style, as an attribute (`className=`, `class=`, `style=`) or handed on under a name that holds one (`className: …`, `mainClassName=`). */
const STYLING = /\b\w*[cC]lassName\b|\b(?:class|style)=/g

/** All an app's `index.css` may hold: the theme, and which packages Tailwind reads for the shared components' classes. */
const STYLESHEET_LINE = /^(?:@import "@designsystem\/ui\/[\w.-]+";|@source "[\w./-]+";|\/\*.*\*\/|)$/

const ALLOWED: Readonly<Record<string, number>> = {
}

const appSources = (): string[] =>
  readdirSync(join(root, "apps"), { withFileTypes: true })
    .map((entry) => join(root, "apps", entry.name, "web", "src"))
    .filter((directory) => existsSync(directory))

test("no app styles itself: the files that still do are the ones listed, no more times than listed", () => {
  const found: Record<string, number> = {}
  for (const directory of appSources()) {
    for (const file of sourceFiles(directory, /\.(?:tsx?|astro)$/)) {
      if (/\.test\.tsx?$/.test(file)) continue
      const count = readFileSync(file, "utf8").match(STYLING)?.length ?? 0
      if (count > 0) found[relative(root, file)] = count
    }
  }
  assert.deepEqual(found, ALLOWED, "an app file writes a class or a style (move the markup to packages/ui), or ALLOWED lists more than is left (lower it)")
})

test("an app's only stylesheet is an index.css that imports the theme", () => {
  const problems: string[] = []
  for (const directory of appSources()) {
    for (const file of sourceFiles(directory, /\.css$/)) {
      const name = relative(root, file)
      if (!name.endsWith("/web/src/index.css")) problems.push(`${name}: an app has no stylesheet but index.css`)
      else for (const line of readFileSync(file, "utf8").split("\n")) if (!STYLESHEET_LINE.test(line.trim())) problems.push(`${name}: ${line.trim()}`)
    }
  }
  assert.deepEqual(problems, [])
})
