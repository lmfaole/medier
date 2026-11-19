/**
 * Reads content from the local database: the rows of a collection as the
 * apps read them. A list or an object comes back from its JSON
 * text, an optional field that is empty is left out, and every row is checked
 * against the collection's own row schema before it is handed on.
 */

import { queryRows } from "@designsystem/config/d1-query"
import * as v from "valibot"

import { COLLECTIONS } from "./collections.ts"
import { SELECTS } from "./tables.ts"
import type { Collection } from "./spec.ts"
import { checked, sortRows, type Row } from "./row-schema.ts"

const StoredRow = v.record(v.string(), v.union([v.string(), v.number(), v.null()]))

function collectionOf(type: string): Collection {
  const found = COLLECTIONS.find((candidate) => candidate.type === type)
  if (!found) throw new Error(`${type} is not a collection`)
  return found
}

/** One stored row as the row the apps read. */
export function rowFromStored(collection: Collection, stored: v.InferOutput<typeof StoredRow>): Row {
  const row: Row = {}
  for (const field of collection.fields) {
    const value = stored[field.key]
    if (value === null || value === undefined) {
      if (!field.optional) row[field.key] = null
    } else if ((field.kind === "list" || field.kind === "object") && typeof value === "string") {
      row[field.key] = JSON.parse(value)
    } else {
      row[field.key] = value
    }
  }
  return checked(collection, row)
}

/** The rows of the collections `types`, in the collection's order. */
export async function readContentFromDatabase(db: D1Database, types: readonly string[]): Promise<Map<string, Row[]>> {
  const entries = await Promise.all(
    types.map(async (type): Promise<[string, Row[]]> => {
      const collection = collectionOf(type)
      const select = SELECTS[type]
      if (select === undefined) throw new Error(`${type} has no table`)
      const stored = await queryRows(db, select, StoredRow)
      return [type, sortRows(collection, stored.map((row) => rowFromStored(collection, row)))]
    }),
  )
  return new Map(entries)
}
