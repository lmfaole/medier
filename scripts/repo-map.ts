/**
 * `npm run repo:map -- <app>`: one app in about thirty lines (its pages, its server files, the tables it reads,
 * the files and commands its AGENTS.md names), generated from the tree so it cannot be out of date. For the
 * start of a session, instead of listing directories and reading the whole AGENTS.md.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { APPS } from "./apps.ts"
import { commandLines, filesNamed, formatMap, introOf, pagePath } from "./repo-map-plan.ts"

const root = join(import.meta.dirname, "..")
const app = process.argv[2] ?? ""
if (!APPS.some((entry) => entry.name === app)) throw new Error(`usage: npm run repo:map -- <${APPS.map((entry) => entry.name).join("|")}>`)

function listFiles(directory: string, prefix = ""): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(join(directory, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`],
  )
}

const web = join(root, "apps", app, "web", "src")
const sources = listFiles(web).filter((file) => /\.(?:tsx?|astro)$/.test(file) && !file.startsWith("generated/") && !file.endsWith(".test.ts"))
const contracts = new Set<string>()
for (const file of sources) {
  for (const match of readFileSync(join(web, file), "utf8").matchAll(/@designsystem\/contracts\/([\w-]+)/g)) contracts.add(match[1] ?? "")
}
const agentsFile = join(root, "apps", app, "AGENTS.md")
const agents = existsSync(agentsFile) ? readFileSync(agentsFile, "utf8") : ""

console.log(
  formatMap({
    app,
    routes: listFiles(join(web, "pages")).map((file) => pagePath(file)).filter((path): path is string => path !== undefined),
    apiFiles: sources.filter((file) => file.startsWith("server/") || file.startsWith("pages/api/")),
    contracts: [...contracts].toSorted(),
    intro: introOf(agents),
    files: filesNamed(agents),
    commands: commandLines(agents),
  }),
)
