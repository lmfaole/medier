/** The files under a directory whose name matches `pattern`, `node_modules` and `dist` left out: what the repository's own tests read. */

import { readdirSync } from "node:fs"
import { join } from "node:path"

export function sourceFiles(directory: string, pattern: RegExp): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...sourceFiles(path, pattern))
    else if (pattern.test(entry.name)) files.push(path)
  }
  return files
}
