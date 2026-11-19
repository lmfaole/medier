import { AxeBuilder } from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

import { PAGES, urlOf } from "./pages.ts"

const history = PAGES.find((page) => page.app === "music" && page.path.startsWith("/historikk"))

function historyUrl(): string {
  if (history === undefined) throw new Error("the music history page is not in pages.ts")
  return urlOf(history)
}

test("an artist in a list links to its own page, which passes axe, says the rest at its foot and links on to the album", async ({ page }) => {
  await page.goto(historyUrl())
  const link = page.locator('main a[href*="/artist/"]').first()
  const name = (await link.innerText()).trim()
  await link.click()

  await expect(page).toHaveURL(/\/artist\/[a-z0-9-]+$/)
  await expect(page.locator("dialog")).toHaveCount(0)
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible()
  await expect(page.getByRole("region", { name: `Om ${name}` }).getByText("Lengste rekke")).toBeVisible()
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()
  expect(violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => violation.id)).toEqual([])

  await page.locator('main a[href*="/album/"]').first().click()
  await expect(page).toHaveURL(/\/album\/[a-z0-9-]+$/)
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
})

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false })

  test("the name links are in the HTML and lead to a page with its figures", async ({ page }) => {
    await page.goto(historyUrl())
    const link = page.locator('main a[href*="/artist/"]').first()
    const name = (await link.innerText()).trim()
    await link.click()
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible()
    await expect(page.getByText("Lengste rekke")).toBeVisible()
  })
})
