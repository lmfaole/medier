import { expect, test } from "@playwright/test"

import { APPS_UNDER_TEST, rootOf } from "./pages.ts"

const work = APPS_UNDER_TEST.find((app) => app.name === "work")

// The one public, indexable page: a search engine must not be told to stay away, and the parts a visitor came for are there.
test("work is open to search engines and shows the CV", async ({ page }) => {
  if (work === undefined) throw new Error("work is not an app under test")
  const response = await page.goto(rootOf(work))
  expect(response?.status()).toBe(200)
  expect(response?.headers()["x-robots-tag"]).toBeUndefined()
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0)

  await expect(page.getByRole("heading", { level: 2, name: "Erfaring" })).toBeVisible()
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
})
