import { strict as assert } from "node:assert"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join, normalize, relative, resolve, sep } from "node:path"
import { test } from "node:test"

import { sourceFiles } from "./source-files.ts"

const root = join(import.meta.dirname, "..")

interface Specifier {
  line: number
  value: string
}

/** The module specifiers a source file imports: static `from`, and dynamic `import()`. */
function specifiers(source: string): Specifier[] {
  const found: Specifier[] = []
  // Static imports and re-exports; `from` may sit lines below the statement's start.
  const statement = /^\s*(?:import|export)\b[\s\S]{0,200}?from\s*['"]([^'"]+)['"]/gm
  for (const match of source.matchAll(statement)) {
    const value = match[1]
    if (value === undefined) continue
    found.push({ line: source.slice(0, match.index).split("\n").length, value })
  }
  const dynamic = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  for (const match of source.matchAll(dynamic)) {
    const value = match[1]
    if (value === undefined) continue
    found.push({ line: source.slice(0, match.index).split("\n").length, value })
  }
  return found
}

test("no app imports another app's source", () => {
  const appsRoot = join(root, "apps")
  const offenders: string[] = []
  for (const app of readdirSync(appsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    const appSource = join(appsRoot, app.name, "web", "src")
    if (!existsSync(appSource)) continue
    for (const file of sourceFiles(appSource, /\.[cm]?[jt]sx?$/)) {
      const source = readFileSync(file, "utf8")
      for (const { line, value } of specifiers(source)) {
        if (!value.startsWith(".")) continue
        const target = normalize(resolve(dirname(file), value))
        if (target === appSource) continue
        const intoApps = relative(appsRoot, target)
        if (intoApps.startsWith("..") || intoApps.startsWith(sep)) continue
        const reachedApp = intoApps.split(sep)[0]
        if (reachedApp === app.name) continue
        offenders.push(`${relative(file, appSource)}:${line}: imports ${value}, which is ${reachedApp}'s source`)
      }
    }
  }
  assert.deepEqual(offenders, [])
})