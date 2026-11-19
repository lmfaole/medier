import { strict as assert } from "node:assert"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve, sep } from "node:path"
import { test } from "node:test"

const root = join(import.meta.dirname, "..")

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: "utf8" }).filter((file) => !file.split(sep).includes("node_modules") && !file.split(sep).includes("dist"))
}

/** `packages/ui` is covered by its own `theme.css`; the others only reach an app's CSS through an `@source` in it. */
const SELF_COVERING = new Set(["ui"])

// Tailwind skips `node_modules`, where a package's components resolve, so without an `@source` their classes are never generated and the page is unstyled.
test("an app's stylesheet scans every package with components that the app imports", () => {
  const packagesWithComponents = readdirSync(join(root, "packages")).filter((name) => !SELF_COVERING.has(name) && existsSync(join(root, "packages", name, "src")) && sourceFiles(join(root, "packages", name, "src")).some((file) => file.endsWith(".tsx")))
  for (const app of readdirSync(join(root, "apps"))) {
    const web = join(root, "apps", app, "web")
    const css = join(web, "src", "index.css")
    if (!existsSync(css)) continue
    const sources = [...readFileSync(css, "utf8").matchAll(/@source\s+"([^"]+)"/g)].map((match) => resolve(dirname(css), match[1] ?? ""))
    const code = sourceFiles(join(web, "src")).filter((file) => /\.(?:tsx?|astro)$/.test(file)).map((file) => readFileSync(join(web, "src", file), "utf8"))
    for (const name of packagesWithComponents) {
      if (!code.some((text) => text.includes(`@designsystem/${name}/`))) continue
      assert.ok(sources.includes(join(root, "packages", name, "src")), `apps/${app}/web/src/index.css needs @source for packages/${name}/src`)
    }
  }
})
