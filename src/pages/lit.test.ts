import { strict as assert } from "node:assert"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"

const pages = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? pages(join(dir, entry.name)) : entry.name.endsWith(".astro") ? [join(dir, entry.name)] : []))

test("a page that leads with a main picture mounts the light: every page of a detail component has <Lit client:idle />", () => {
  const missing = pages(import.meta.dirname).filter((file) => /components\/detail'/.test(readFileSync(file, "utf8")) && !/<Lit client:idle \/>/.test(readFileSync(file, "utf8")))
  assert.deepEqual(missing, [], "the hero picture's frame only reads the light; `Lit` is what moves it (and the tilt button), since the detail components are not hydrated")
})
