import { expect, test } from "@playwright/test"

import { PAGES, urlOf } from "./pages.ts"

/** Only what can be clicked or typed in takes keyboard focus: text, charts and containers do not, so a Tab never stops on something that does nothing. */
const FOCUSABLE = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"])

for (const target of PAGES) {
  test(`${target.app}${target.path}: only links, buttons and fields take focus`, async ({ page }, info) => {
    test.setTimeout(120_000)
    if (info.project.name !== "chromium") test.skip()
    await page.goto(urlOf(target))
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible()

    const offenders: string[] = []
    for (let step = 0; step < 40; step += 1) {
      await page.keyboard.press("Tab")
      const focused = await page.evaluate(() => {
        const element = document.activeElement
        return element === null || element === document.body ? null : { tag: element.tagName, label: (element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 40) }
      })
      if (focused !== null && !FOCUSABLE.has(focused.tag)) offenders.push(`${focused.tag.toLowerCase()} "${focused.label}"`)
    }
    expect(offenders).toEqual([])
  })
}
