import { expect, test } from "@playwright/test"

import { PAGES, urlOf } from "./pages.ts"

const target = PAGES.find((page) => page.app === "music" && page.path === "/bibliotek")
if (target === undefined) throw new Error("music /bibliotek is not among the pages under test")

test("the library follows the search field without a page load or a history entry", async ({ page }, info) => {
  if (info.project.name !== "chromium") test.skip()
  let loads = 0
  page.on("load", () => (loads += 1))
  await page.goto(urlOf(target))
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible()
  const works = page.locator("main a:not(nav[aria-label=\"Brødsmuler\"] a)")
  const all = await works.count()
  const history = await page.evaluate(() => window.history.length)

  const search = page.getByRole("searchbox")
  await search.click()
  await page.keyboard.type("zzzqx", { delay: 40 })
  await expect(page).toHaveURL(/\?q=zzzqx$/)
  await expect(works).toHaveCount(0)
  await expect(search).toBeFocused()

  await search.fill("")
  await expect(page).not.toHaveURL(/\?/)
  await expect(works).toHaveCount(all)
  expect(await page.evaluate(() => window.history.length)).toBe(history)
  expect(loads).toBe(1)
})
