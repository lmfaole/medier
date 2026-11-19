/** The dump of a database as it lies in `data-dump/<domain>/`: each table's text, by the table's name. */

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

export const dumpDirectory = (root: string, domain: string): string => join(root, "data-dump", domain)

export function readDump(directory: string): Map<string, string> {
  if (!existsSync(directory)) return new Map()
  return new Map(readdirSync(directory).filter((name) => name.endsWith(".jsonl")).map((name): [string, string] => [name.replace(/\.jsonl$/, ""), readFileSync(join(directory, name), "utf8")]))
}
