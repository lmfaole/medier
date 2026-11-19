import { expect, test } from "@playwright/test"

import { PAGES, urlOf } from "./pages.ts"

function addressOf(app: string, path: string): string {
  const target = PAGES.find((page) => page.app === app && page.path === path)
  if (target === undefined) throw new Error(`${app}${path} is not in pages.ts`)
  return urlOf(target)
}

test("there is no header, sidebar or bottom bar; the breadcrumbs lead from a page to its app and to the hub listing the media apps", async ({ page }) => {
  await page.goto(addressOf("music", "/historikk?month=2021-03"))
  await expect(page.getByRole("banner")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Toggle Sidebar" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Meny" })).toHaveCount(0)

  const crumbs = page.getByRole("navigation", { name: "Brødsmuler" })
  await expect(crumbs.getByRole("link", { name: "Historikk" })).toHaveAttribute("aria-current", "page")
  await crumbs.getByRole("link", { name: "Musikk" }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Musikk" })).toBeVisible()

  await page.getByRole("navigation", { name: "Brødsmuler" }).getByRole("link", { name: "Medier" }).click()
  await expect(page).toHaveURL(/\/apps\/medier\/$/)
  await expect(page.getByRole("heading", { level: 1, name: "Medier" })).toBeVisible()
  await expect(page.getByRole("navigation", { name: "Mediaappene" }).getByRole("link", { name: "Film" })).toBeVisible()
})

test("an app's own pages are reached from the menu on its pages", async ({ page }) => {
  await page.goto(addressOf("music", "/"))
  await page.getByRole("navigation", { name: "Sider i musikk" }).getByRole("link", { name: /^Tilbakeblikk/ }).click()

  await expect(page).toHaveURL(/\/tilbakeblikk$/)
  await expect(page.getByRole("heading", { level: 1, name: "Tilbakeblikk" })).toBeVisible()

  await page.getByRole("navigation", { name: "Tilbakeblikk" }).getByRole("link", { name: /^Uke for uke/ }).click()
  await expect(page).toHaveURL(/\/tilbakeblikk\/uke$/)
  await expect(page.getByRole("heading", { level: 1, name: "Uke for uke" })).toBeVisible()
})

test("a film in a list links to its own page, and Back returns to the list", async ({ page }) => {
  await page.goto(addressOf("film", "/historikk"))
  await page.locator('main a[href*="/film/film/"]').first().click()

  await expect(page).toHaveURL(/\/film\/film\/[a-z0-9-]+$/)
  await expect(page.locator("dialog")).toHaveCount(0)
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()

  await page.goBack()
  await expect(page).toHaveURL(/\/film\/historikk$/)
})
