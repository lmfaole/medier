/**
 * A row, as the apps read it (Norwegian keys), and what holds it to its
 * collection: the valibot schema built from the spec's fields, the check that
 * throws with a message that names the field, and the order rows come in.
 */

import * as v from "valibot"

import type { Collection, Field, Item } from "./spec.ts"

export type Row = Record<string, unknown>

function itemSchema(item: Item) {
  const base = item.kind === "integer" ? v.pipe(v.number(), v.integer()) : item.kind === "boolean" ? v.boolean() : item.choices ? v.picklist(item.choices) : v.string()
  return item.nullable ? v.nullable(base) : base
}

/** The row's own object for a list item or an object. */
function itemsSchema(entry: Field) {
  return v.strictObject(Object.fromEntries((entry.items ?? []).map((item) => [item.key, itemSchema(item)])))
}

function fieldSchema(entry: Field) {
  const base = (() => {
    switch (entry.kind) {
      case "integer":
        return v.pipe(v.number(), v.integer())
      case "number":
        return v.number()
      case "list":
        return v.array(itemsSchema(entry))
      case "object":
        return itemsSchema(entry)
      default:
        return entry.choices ? v.picklist(entry.choices) : v.string()
    }
  })()
  if (entry.nullable) return v.nullable(base)
  if (entry.optional) return v.optional(base)
  return base
}

const rowSchemas = new Map<Collection, ReturnType<typeof buildRowSchema>>()

function buildRowSchema(collection: Collection) {
  return v.strictObject(Object.fromEntries(collection.fields.map((entry) => [entry.key, fieldSchema(entry)])))
}

/** The shape of one row; keys the collection does not list are an error. Built once per collection: a Worker has 10 ms of CPU and a row is checked many times. */
export function rowSchema(collection: Collection) {
  const known = rowSchemas.get(collection)
  if (known !== undefined) return known
  const built = buildRowSchema(collection)
  rowSchemas.set(collection, built)
  return built
}

export function checked(collection: Collection, row: unknown): Row {
  const result = v.safeParse(rowSchema(collection), row)
  if (!result.success) {
    const issues = result.issues.map((issue) => `${issue.path?.map((step) => String(step.key)).join(".") ?? "row"}: ${issue.message}`)
    throw new Error(`${collection.type} does not match its row shape: ${issues.join("; ")}`)
  }
  return result.output
}

function compare(left: unknown, right: unknown): number {
  if (typeof left === "number" && typeof right === "number") return left - right
  return String(left).localeCompare(String(right), "en")
}

/** Rows in the collection's order: by its order field, then by id. */
export function sortRows(collection: Collection, rows: readonly Row[]): Row[] {
  return rows.toSorted((a, b) => compare(a[collection.orderField], b[collection.orderField]) || compare(a[collection.idField], b[collection.idField]))
}
