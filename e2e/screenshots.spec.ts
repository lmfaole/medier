/**
 * A full-page screenshot of every page in every project, in light and dark, for
 * looking at the apps at each size without opening them one by one. In CSS pixels: a phone's
 * tallest page can be thousands of them, and at three device pixels each the picture would pass the
 * 32 767 px a browser can capture. Written to
 * `e2e/screenshots/<project>/<theme>/`, which is git-ignored.
 */

import { expect, test } from "@playwright/test"

import { PAGES, urlOf } from "./pages.ts"

for (const scheme of ["light", "dark"] as const) {
  for (const target of PAGES) {
    test(`${scheme}: ${target.app}${target.path}`, async ({ page }, testInfo) => {
      await page.emulateMedia({ colorScheme: scheme })
      await page.goto(urlOf(target))
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
      // A page that keeps polling never goes idle; the picture is taken anyway.
      await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => undefined)
      const name = `${target.app}${target.path === "/" ? "" : target.path.replaceAll("/", "-")}`
      await page.screenshot({ path: `e2e/screenshots/${testInfo.project.name}/${scheme}/${name}.png`, fullPage: true, scale: "css" })
    })
  }
}
