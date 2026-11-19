import { expect, test, type Page } from "@playwright/test"

import { PAGES, urlOf } from "./pages.ts"

const page0 = PAGES[0]

const PROBE = `
  <div id="probe-stagger" class="motion-stagger"><span>one</span><span>two</span></div>
  <span id="probe-live" class="motion-live"></span>
  <span id="probe-reveal" class="motion-reveal"></span>
  <span id="probe-token" style="transition-duration: var(--motion-duration-fast)"></span>
  <span id="probe-spinner" data-motion="essential" style="animation: spin 1s linear infinite"></span>
`

async function animationNames(page: Page) {
  await page.evaluate((html) => document.body.insertAdjacentHTML("beforeend", html), PROBE)
  return page.evaluate(() => ({
    stagger: getComputedStyle(document.querySelector("#probe-stagger > :nth-child(2)") ?? document.body).animationName,
    live: getComputedStyle(document.querySelector("#probe-live") ?? document.body).animationName,
    reveal: getComputedStyle(document.querySelector("#probe-reveal") ?? document.body).animationName,
    spinnerDuration: getComputedStyle(document.querySelector("#probe-spinner") ?? document.body).animationDuration,
    fastSeconds: Number.parseFloat(getComputedStyle(document.querySelector("#probe-token") ?? document.body).transitionDuration),
  }))
}

test.describe("with motion allowed", () => {
  test.use({ reducedMotion: "no-preference" })

  test("the shared movements run and the tokens have their values", async ({ page }) => {
    if (page0 === undefined) throw new Error("pages.ts is empty")
    await page.goto(urlOf(page0))
    const names = await animationNames(page)
    expect(names.stagger).toBe("motion-rise")
    expect(names.live).toBe("motion-pulse")
    expect(names.reveal).toBe("motion-rise")
    expect(names.fastSeconds).toBeCloseTo(0.15, 5)
  })
})

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" })

  test("loops and entrances are off, the tokens collapse, essential feedback keeps its pace", async ({ page }) => {
    if (page0 === undefined) throw new Error("pages.ts is empty")
    await page.goto(urlOf(page0))
    const names = await animationNames(page)
    expect(names.stagger).toBe("none")
    expect(names.live).toBe("none")
    expect(names.reveal).toBe("none")
    expect(names.fastSeconds).toBeLessThan(0.001)
    expect(names.spinnerDuration).toBe("1s")
  })
})
