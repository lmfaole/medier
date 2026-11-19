import { AxeBuilder } from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

import { PAGES, urlOf } from "./pages.ts"

const history = PAGES.find((page) => page.app === "podkast" && page.path.startsWith("/historikk"))

function historyUrl(): string {
  if (history === undefined) throw new Error("the podkast history page is not in pages.ts")
  return urlOf(history)
}

test("a show in a list links to its own page, which passes axe and leads on to an episode", async ({ page }) => {
  await page.goto(historyUrl())
  const first = page.locator('main a[href*="/show/"]').first()
  const show = (await first.innerText()).trim()
  await first.click()

  await expect(page).toHaveURL(/\/show\/[a-z0-9-]+$/)
  await expect(page.locator("dialog")).toHaveCount(0)
  await expect(page.getByRole("heading", { level: 1, name: show })).toBeVisible()
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()
  expect(violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => violation.id)).toEqual([])

  await page.locator('main a[href*="/episode/"]').first().click()
  await expect(page).toHaveURL(/\/episode\/[a-z0-9-]+$/)
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
})

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false })

  test("the show links are in the HTML and lead to a page with its figures", async ({ page }) => {
    await page.goto(historyUrl())
    await page.locator('main a[href*="/show/"]').first().click()
    await expect(page.getByText(/Du spilte .+ \d/)).toBeVisible()
  })
})
