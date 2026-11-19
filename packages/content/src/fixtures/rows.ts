/**
 * The sample rows the tests and the local seed use: what the JSON samples the
 * collections name hold, each collection in its own order.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { COLLECTIONS } from "../collections.ts"
import { sortRows, type Row } from "../row-schema.ts"
import type { Collection } from "../spec.ts"

const root = join(import.meta.dirname, "..", "..", "..", "..")

function asRow(value: unknown, collection: Collection): Row {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${collection.type}: a sample row is not an object`)
  return Object.fromEntries(Object.entries(value))
}

/** The rows of `collection` out of its sample file. */
export function sampleRows(collection: Collection): Row[] {
  if (collection.sample === undefined) return []
  const parsed: unknown = JSON.parse(readFileSync(join(root, collection.sample), "utf8"))
  const part = collection.section === undefined ? parsed : Object.entries(Object(parsed)).find(([name]) => name === collection.section)?.[1]
  if (collection.singleton) return [asRow(part, collection)]
  if (!Array.isArray(part)) throw new Error(`${collection.sample} is not a list${collection.section ? ` under ${collection.section}` : ""}`)
  return part.map((row) => asRow(row, collection))
}

/** Every collection's sample rows, by type. */
export const rows: ReadonlyMap<string, readonly Row[]> = new Map(COLLECTIONS.map((collection) => [collection.type, sortRows(collection, sampleRows(collection))]))
