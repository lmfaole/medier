/**
 * Cards are rare (the design system's README, rule 8): a card is one self-contained item comparable with its siblings
 * (a place, a period), a tile that is a link as a whole, or the frame of a chart. A heading over a list, a table or one sentence is
 * a `PageSection`, not a card. `ALLOWED` is the files that still draw one and what for; it may only shrink, and a file added to it
 * needs a reason a user would see (an item to compare, a link to follow, a chart).
 */

import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { test } from "node:test"

import { sourceFiles } from "./source-files.ts"

const root = join(import.meta.dirname, "..")

const CARD = /components\/card["']|\b(?:ChartCard|PictureCard|PeriodCard|SentenceCard|StatCard)\b/

const ALLOWED: Readonly<Record<string, string>> = {
  "packages/ui/src/components/period-card.tsx": "one card per week, month or year",
  "packages/ui/src/components/periods-page.tsx": "the period cards",
  "packages/ui/src/components/place-grid.tsx": "one card per place",
}

test("only the files that have an item to compare, a link or a chart draw a card", () => {
  const found: Record<string, string> = {}
  for (const directory of ["packages", "apps"]) {
    for (const file of sourceFiles(join(root, directory), /\.(?:tsx|ts|astro)$/)) {
      if (/\.test\.tsx?$/.test(file)) continue
      if (CARD.test(readFileSync(file, "utf8"))) found[relative(root, file)] = ALLOWED[relative(root, file)] ?? "NOT ALLOWED: a card needs an item to compare, a link or a chart; otherwise it is a PageSection"
    }
  }
  assert.deepEqual(found, ALLOWED)
})
