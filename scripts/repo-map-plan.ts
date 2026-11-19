/**
 * What `npm run repo:map -- <app>` prints, as pure functions: an app's URLs from its page files, the files
 * its AGENTS.md names, its first paragraph and its command lines. The reading of the disk is `repo-map.ts`'s.
 */

/** The URL an Astro page file answers (`pages/kilder.astro`, `pages/film/[slug].astro`), or undefined for the 404 page and the API endpoints. */
export function pagePath(file: string): string | undefined {
  const name = file.replace(/\.(?:astro|tsx?|mdx?)$/, "")
  if (name === "404" || name === "500" || name.startsWith("api/") || name.startsWith("_")) return undefined
  const segments = name.split("/").filter((segment) => segment !== "index")
  return `/${segments.join("/")}`
}

/** The first paragraph after the title, which says what the app is. */
export function introOf(agents: string): string {
  const paragraphs = agents.split(/\n\s*\n/).map((paragraph) => paragraph.trim())
  return paragraphs.find((paragraph) => paragraph !== "" && !paragraph.startsWith("#")) ?? ""
}

/** The files named in the first column of the AGENTS.md tables, as written: `` `sync-rust/src/log.rs` ``. */
export function filesNamed(agents: string): string[] {
  const named: string[] = []
  for (const line of agents.split("\n")) {
    const cell = /^\|\s*([^|]+?)\s*\|/.exec(line)?.[1]
    if (cell === undefined || cell === "Where" || /^-+$/.test(cell)) continue
    named.push(...[...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? ""))
  }
  return named.filter((name) => name !== "")
}

/** The lines that say how to run the app's tools: "Commands from …" and "Timers: …". */
export function commandLines(agents: string): string[] {
  return agents.split("\n").filter((line) => /^(Commands|Timers|Data flow)\b/.test(line))
}

export interface AppMap {
  app: string
  routes: string[]
  apiFiles: string[]
  contracts: string[]
  intro: string
  files: string[]
  commands: string[]
}

export function formatMap(map: AppMap): string {
  const section = (title: string, lines: readonly string[]): string[] => (lines.length === 0 ? [] : ["", `${title}:`, ...lines.map((line) => `  ${line}`)])
  return [
    `# ${map.app}`,
    map.intro,
    ...section("pages", map.routes),
    ...section("server", map.apiFiles),
    ...section("tables it reads (packages/contracts)", map.contracts),
    ...section("files AGENTS.md describes", map.files),
    ...section("commands and timers", map.commands),
    "",
    `The rest is in apps/${map.app}/AGENTS.md.`,
  ].join("\n")
}
