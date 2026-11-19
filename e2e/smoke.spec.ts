import { expect, test } from "@playwright/test"

import { PAGES, urlOf } from "./pages.ts"

for (const target of PAGES) {
  test(`${target.app}${target.path} renders its heading and throws nothing`, async ({ page }) => {
    // An uncaught exception is a bug; a failed request to a cover or another outside host is not.
    const exceptions: string[] = []
    page.on("pageerror", (error) => exceptions.push(error.message))
    // The server's HTML and the browser's first render have to agree, or React says so and starts over; a policy that blocks an island's script says so here too.
    page.on("console", (message) => {
      if (/hydrat|Content Security Policy/i.test(message.text())) exceptions.push(message.text())
    })

    const response = await page.goto(urlOf(target))

    expect(response?.status()).toBe(200)
    await expect(page.getByRole("heading", { level: 1, name: target.heading })).toBeVisible()
    // Astro takes `ssr` off an island when its component has hydrated, so one that still has it never ran.
    await expect(page.locator("astro-island")).toHaveCount(target.islands ?? 0)
    await expect(page.locator("astro-island[ssr]")).toHaveCount(0)
    if (target.serverIsland !== undefined) await expect(page.locator("main")).toContainText(target.serverIsland)
    expect(exceptions).toEqual([])
  })
}
