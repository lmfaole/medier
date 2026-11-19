/**
 * Whether an app's static API in `web/public/api/` was built from its current
 * sources, checked without cargo or SQLite. The Rust tool writes a fingerprint
 * of every source file into `meta.json`; this recomputes them and compares.
 * FNV-1a 64-bit, the same as `crates/shared-data/src/fingerprint.rs`.
 */

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const MAX_64_BIT = (1n << 64n) - 1n

/** FNV-1a 64-bit over the raw bytes, as fixed-width hex. */
export function fnv1aHex(bytes: Uint8Array): string {
  let hash = FNV_OFFSET_BASIS
  for (const byte of bytes) hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & MAX_64_BIT
  return hash.toString(16).padStart(16, '0')
}

/**
 * How `meta.json` names its sources. `data-dir`: the `data/*.json` file names
 * under `kilder` (accounts, cv, photos, podcast). `listed`: paths relative to
 * the app under `sources`, which may reach into other apps.
 */
export type SourceKind = 'data-dir' | 'listed'

function entries(value: unknown, list: string, file: string, fingerprint: string): [string, string][] | null {
  if (typeof value !== 'object' || value === null || !(list in value)) return null
  const items: unknown = Object.entries(value).find(([key]) => key === list)?.[1]
  if (!Array.isArray(items) || items.length === 0) return null
  const pairs: [string, string][] = []
  for (const item of items) {
    if (typeof item !== 'object' || item === null) return null
    const name: unknown = Object.entries(item).find(([key]) => key === file)?.[1]
    const print: unknown = Object.entries(item).find(([key]) => key === fingerprint)?.[1]
    if (typeof name !== 'string' || typeof print !== 'string') return null
    pairs.push([name, print])
  }
  return pairs
}

/** The recorded sources as path (relative to the app) → fingerprint, or `null` when `meta` does not have them. */
export function recordedSources(meta: unknown, kind: SourceKind): Map<string, string> | null {
  const pairs = kind === 'data-dir' ? entries(meta, 'kilder', 'fil', 'fingeravtrykk') : entries(meta, 'sources', 'file', 'fingerprint')
  if (pairs === null) return null
  return new Map(pairs.map(([name, print]) => [kind === 'data-dir' ? `data/${name}` : name, print]))
}

/**
 * What is out of sync: a recorded file that changed or is gone, and a file in
 * `required` (the app's own `data/*.json`) that the Rust tool did not read.
 * `read` returns a file's bytes, or `null` when it does not exist.
 */
export function apiSyncProblems(
  recorded: Map<string, string>,
  read: (path: string) => Uint8Array | null,
  required: string[],
): string[] {
  const problems: string[] = []
  for (const [path, fingerprint] of [...recorded].toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const content = read(path)
    if (content === null) problems.push(`${path} is gone`)
    else if (fnv1aHex(content) !== fingerprint) problems.push(`${path} has changed`)
  }
  for (const path of required.toSorted()) {
    if (!recorded.has(path)) problems.push(`${path} is not read by data-rust`)
  }
  return problems
}
