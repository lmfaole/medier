/**
 * Wide screens are used, not left empty (the design system's README, rule 7, and `docs/CSS-LAYOUT.md`). The page column has
 * no maximum width, so what stands in it must lay itself out in more columns: `Grid`, `Split`, the rows' `LIST_COLUMNS`,
 * or a layout component of `packages/ui`. A `max-w-*` in these packages is only the measure of a line of text or the width
 * of a heading, never a layout; `ALLOWED_MAX_W` may only shrink.
 */

import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join, relative } from "node:path"
import { test } from "node:test"

import { sourceFiles } from "./source-files.ts"

const root = join(import.meta.dirname, "..")

const ALLOWED_MAX_W: Readonly<Record<string, readonly string[]>> = {
  "packages/ui/src/components/entity-cover-hero.tsx": ["max-w-none"],
  "packages/ui/src/components/entity-hero.tsx": ["max-w-none"],
}

test("no layout of the apps or their shared packages is capped in width", () => {
  const found: Record<string, string[]> = {}
  const directories = ["packages/ui/src", "packages/watch/src", "packages/shelf/src", ...["film", "tv", "games", "books", "boardgames", "podkast", "music", "medier", "forside", "work"].map((app) => `apps/${app}/web/src`)]
  for (const directory of directories) {
    for (const file of sourceFiles(join(root, directory), /\.(?:tsx|astro|css)$/)) {
      const classes = [...new Set(readFileSync(file, "utf8").match(/(?<![\w-])max-(?:w|inline)-[^\s"'`}]+/g) ?? [])].toSorted()
      if (classes.length > 0) found[relative(root, file)] = classes
    }
  }
  assert.deepEqual(found, ALLOWED_MAX_W, "a layout got a max-width (lay it out in more columns instead), or ALLOWED_MAX_W lists more than is left (lower it)")
})

test("the page column is the design system's, and it has no maximum width", () => {
  const column = readFileSync(createRequire(join(root, "packages", "ui", "package.json")).resolve("@lmfaole/designsystem/lib/page-width"), "utf8").match(/PAGE_COLUMN\s*=\s*"([^"]*)"/)?.[1] ?? ""
  assert.doesNotMatch(column, /max-w|max-inline/)
})
