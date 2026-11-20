// Draws the app icons (public/icons, public/apple-touch-icon.png, public/favicon.png) from one SVG: a play triangle, the mark of media, in the design system's
// ink (#171717, `primary`) on white. Run `node scripts/icons.mjs` after changing it.
import { createRequire } from "node:module"

// Playwright is not a dependency of the project: use the one installed globally (`npm i -g playwright` where there is none).
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT ?? "playwright")

const INK = "#171717"
const PAPER = "#ffffff"

/** `safe` is the share of the square the drawing may use: a maskable icon is cut to a circle by the system. `round` rounds the corners (only the favicon: an `any` icon is opaque, the system cuts it). */
const svg = (safe, round) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <rect width="100" height="100" rx="${round ? 22 : 0}" fill="${INK}"/>
  <g transform="translate(50 50) scale(${safe}) translate(-50 -50)">
    <path d="M38 27 L74 50 L38 73 Z" fill="${PAPER}" stroke="${PAPER}" stroke-width="7" stroke-linejoin="round"/>
  </g>
</svg>`

const ICONS = [
  ["public/icons/icon-192.png", 192, 1, false],
  ["public/icons/icon-512.png", 512, 1, false],
  ["public/icons/maskable-512.png", 512, 0.72, false],
  ["public/apple-touch-icon.png", 180, 0.86, false],
  ["public/favicon.png", 64, 1, true],
]

const browser = await chromium.launch()
const page = await browser.newPage()
for (const [path, size, safe, round] of ICONS) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg(safe, round)}`)
  await page.locator("svg").screenshot({ path, omitBackground: true })
  console.log(path)
}
await browser.close()
