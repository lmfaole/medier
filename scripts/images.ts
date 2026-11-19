/**
 * The landing of pictures an app names (album covers, film posters): every picture a snapshot names is kept under
 * `.data/raw/<kind>/` (an original, never deleted or rewritten) and the ones the snapshot names are copied into the
 * app's `public/<kind>/`, where the build ships them as assets. A picture the source does not answer for is left out
 * and tried again at the next run, so one outage never costs the rest.
 */

import { copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

/** Every picture path the JSON files under `directory` name (`find` reads them out of a file's text), each once. */
export function imagesNamedIn(directory: string, find: (text: string) => string[]): string[] {
  const found = new Set<string>()
  const visit = (current: string) => {
    for (const name of readdirSync(current)) {
      const path = join(current, name)
      if (statSync(path).isDirectory()) visit(path)
      else if (name.endsWith(".json")) for (const image of find(readFileSync(path, "utf8"))) found.add(image)
    }
  }
  if (existsSync(directory)) visit(directory)
  return [...found].toSorted()
}

export type Fetcher = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; bytes(): Promise<Uint8Array> }>

/** The `fetch` every script lands pictures with: a source gets twenty seconds to answer. */
export const httpFetcher: Fetcher = async (url, init) => {
  const answer = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) })
  return { ok: answer.ok, status: answer.status, bytes: async () => new Uint8Array(await answer.arrayBuffer()) }
}

/** Where a picture comes from: the address and the headers to ask with, or `null` for a path that is no picture of this kind. */
export type Upstream = (path: string) => { url: string; headers: Record<string, string> } | null

/** The picture's bytes from its source, or `null` after `attempts` tries, waiting longer after each. */
export async function downloadImage(path: string, fetcher: Fetcher, upstream: Upstream, attempts = 3, wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))): Promise<Uint8Array | null> {
  const source = upstream(path)
  if (source === null) return null
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const answer = await fetcher(source.url, { headers: source.headers })
      if (answer.ok) return await answer.bytes()
      if (answer.status === 404) return null
    } catch {
      // A network failure is tried again like a 5xx.
    }
    if (attempt < attempts) await wait(1000 * attempt)
  }
  return null
}

export interface LandResult {
  landed: number
  kept: number
  missing: string[]
}

/** A picture that failed every attempt is not asked for again for this long, so one broken source does not cost a minute each run. */
const FAILED_FOR_MS = 12 * 60 * 60 * 1000
/** Up to this many failures are remembered even when nothing else landed; more than that with no success looks like an outage, not like bad pictures. */
const FEW_FAILURES = 10

/** Makes `destination` the same file as `source`: a hard link, else a copy; nothing if it already is. */
function place(source: string, destination: string): void {
  const had = existsSync(destination)
  if (had && statSync(destination).ino === statSync(source).ino) return
  mkdirSync(dirname(destination), { recursive: true })
  if (had) rmSync(destination)
  try {
    linkSync(source, destination)
  } catch {
    copyFileSync(source, destination)
  }
}

/** Removes every file under `directory` that is not in `keep` (paths relative to it), and the folders that end up empty. */
function prune(directory: string, keep: ReadonlySet<string>, relative = ""): boolean {
  let empty = true
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const own = relative === "" ? entry.name : `${relative}/${entry.name}`
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (prune(path, keep, own)) rmdirSync(path)
      else empty = false
    } else if (keep.has(own)) empty = false
    else rmSync(path)
  }
  return empty
}

/**
 * Lands what `store` (a folder, or the folder a given picture is kept in) lacks, then makes `target` hold exactly the pictures named,
 * each a hard link to its file in `store` (a copy where the two are on different disks). What is already linked is left alone, so a run
 * that changed nothing touches no picture, and the build copies the same bytes it did before. `prefix` is the start of each path
 * (`/covers/`), left off in both folders.
 */
export async function landImages({ named, prefix, store, target, fetcher, upstream }: { named: readonly string[]; prefix: string; store: string | ((path: string) => string); target: string; fetcher: Fetcher; upstream: Upstream }): Promise<LandResult> {
  const result: LandResult = { landed: 0, kept: 0, missing: [] }
  const relative = (path: string) => path.slice(prefix.length)
  const have = (path: string) => join(typeof store === "string" ? store : store(path), relative(path))
  const failedMarker = (path: string) => `${have(path)}.failed`
  const recentlyFailed = (path: string) => existsSync(failedMarker(path)) && Date.now() - statSync(failedMarker(path)).mtimeMs < FAILED_FOR_MS
  const lacking = named.filter((path) => !existsSync(have(path)))
  result.kept = named.length - lacking.length
  const queue = lacking.filter((path) => !recentlyFailed(path))
  result.missing.push(...lacking.filter((path) => !queue.includes(path)))
  const attempted = queue.length
  const failed: string[] = []
  const workers = Array.from({ length: 6 }, async () => {
    for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
      const bytes = await downloadImage(path, fetcher, upstream)
      if (bytes === null) {
        result.missing.push(path)
        failed.push(path)
        continue
      }
      mkdirSync(dirname(have(path)), { recursive: true })
      writeFileSync(have(path), bytes)
      rmSync(failedMarker(path), { force: true })
      result.landed += 1
    }
  })
  await Promise.all(workers)
  if (failed.length <= FEW_FAILURES || failed.length < attempted) {
    for (const path of failed) {
      mkdirSync(dirname(have(path)), { recursive: true })
      writeFileSync(failedMarker(path), "")
      utimesSync(failedMarker(path), new Date(), new Date())
    }
  }
  const wanted = new Set<string>()
  for (const path of named) {
    if (!existsSync(have(path))) continue
    wanted.add(relative(path))
    place(have(path), join(target, relative(path)))
  }
  if (existsSync(target)) prune(target, wanted)
  return result
}
