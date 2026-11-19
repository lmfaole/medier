/**
 * Writes the install icons into the hub's `apps/medier/web/public/pwa/` (committed): the hub's own icon, a grid in white on the
 * near-black of the theme, as a plain icon (192, 512) and a maskable one with the mark inside the safe zone, and one 192 icon per
 * app (its lucide mark on its own colour) for the shortcuts of the manifest. Run it when the registry's icon or a colour in
 * `theme.css` changes: `node scripts/pwa-icons.ts`.
 */

import { mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { LayoutGrid, type LucideIcon } from "lucide-react"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import sharp from "sharp"

import { appColorHex } from "../packages/ui/src/lib/app-color.ts"
import { APP_IDS, APPS } from "../packages/ui/src/lib/apps.ts"

const root = join(import.meta.dirname, "..")
const themeCss = readFileSync(join(root, "packages/ui/src/theme.css"), "utf8")

/** The icon art on a 512 square. `inset` is how much of the square the mark takes; a maskable icon keeps to the middle 60%. */
function artwork(icon: LucideIcon, color: string, maskable: boolean): string {
  const size = maskable ? 512 * 0.5 : 512 * 0.58
  const mark = renderToStaticMarkup(createElement(icon, { size, color: "#ffffff", strokeWidth: 1.75 }))
  const offset = (512 - size) / 2
  const corner = maskable ? 0 : 112
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="${corner}" fill="${color}"/><g transform="translate(${offset} ${offset})">${mark}</g></svg>`
}

/** The hub wears no app's colour: the theme's primary (`--primary: oklch(0.205 0 0)`). */
const HUB_COLOR = "#171717"

const directory = join(root, "apps/medier/web/public/pwa")
mkdirSync(directory, { recursive: true })
const png = (svg: string, size: number, file: string) => sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png().toFile(join(directory, file))

await png(artwork(LayoutGrid, HUB_COLOR, false), 512, "icon-512.png")
await png(artwork(LayoutGrid, HUB_COLOR, false), 192, "icon-192.png")
await png(artwork(LayoutGrid, HUB_COLOR, true), 512, "icon-maskable-512.png")
for (const id of APP_IDS) {
  const color = appColorHex(themeCss, id)
  await png(artwork(APPS[id].icon, color, false), 192, `app-${id}-192.png`)
  console.log(`${id}: ${color}`)
}
