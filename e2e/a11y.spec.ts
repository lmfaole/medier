import { AxeBuilder } from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

import { PAGES, urlOf } from "./pages.ts"

for (const target of PAGES) {
  test(`${target.app}${target.path} has no serious accessibility violations`, async ({ page }) => {
    // A library lists every work, and axe is slow on that many rows.
    test.setTimeout(180_000)
    // Sections fade in as they scroll into view, and axe reads text caught mid-fade as low contrast.
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.goto(urlOf(target))
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()

    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()
    const known = target.knownViolations ?? []
    const serious = violations.filter((violation) => (violation.impact === "serious" || violation.impact === "critical") && !known.includes(violation.id))

    // The message names each rule and how many elements break it, so a failure is a to-do list.
    expect(serious.map((violation) => `${violation.id} (${violation.nodes.length}): ${violation.help}`)).toEqual([])
  })
}
