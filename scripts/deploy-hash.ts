/**
 * One hash of what a deploy would upload: every file of the built output (`web/dist`: the assets and the Worker),
 * names and contents in a fixed order, and the Wrangler version, since a new Wrangler may bundle or upload differently.
 * Kept in `.data/published/<app>.dist.sha256` after a successful `wrangler deploy` (the publish timers' own
 * `<app>.sha256` is the hash of the snapshot, a different thing). A deploy whose output hashes the same changes
 * nothing on Cloudflare, so `executePlan` skips it. Not part of the hash: Wrangler's scratch folder `.wrangler` and `.dev.vars`.
 */

import { createHash } from "node:crypto"
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, sep } from "node:path"

const SCRATCH = new Set([".wrangler", ".dev.vars"])

/** The paths (relative, sorted) that count towards the hash. */
export function hashedPaths(relativePaths: readonly string[]): string[] {
  return relativePaths.filter((path) => !path.split(sep).some((part) => SCRATCH.has(part))).toSorted()
}

export function hashBuilt(directory: string, extra = ""): string {
  const hash = createHash("sha256").update(extra).update("\0")
  for (const file of hashedPaths(readdirSync(directory, { recursive: true, encoding: "utf8" }))) {
    let content: Buffer
    try {
      content = readFileSync(join(directory, file))
    } catch {
      continue // a directory
    }
    hash.update(file).update("\0").update(createHash("sha256").update(content).digest()).update("\0")
  }
  return hash.digest("hex")
}

export function readHash(file: string): string | null {
  try {
    return readFileSync(file, "utf8").trim() || null
  } catch {
    return null
  }
}

export function writeHash(file: string, hash: string): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${hash}\n`)
}
