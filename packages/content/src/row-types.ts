/**
 * The valibot schemas of the rows the apps read (`KontoRow`, `StillingRow`, …)
 * and the TypeScript types they infer (`Konto`, `Stilling`, …), written from the
 * collection specs, so a field exists in one place. They replace the types
 * ts-rs made from the Rust structs, and the schemas each app used to write
 * again. `generated/rows.ts` is this text, committed, and `row-types.test.ts`
 * fails when it is out of date.
 */

import { COLLECTIONS } from "./collections.ts"
import type { Collection, Field, Item } from "./spec.ts"

function itemSchema(item: Item): string {
  const base = item.kind === "integer" ? "v.pipe(v.number(), v.integer())" : item.kind === "boolean" ? "v.boolean()" : "v.string()"
  return item.nullable ? `v.nullable(${base})` : base
}

function objectSchema(items: readonly Item[]): string {
  return `v.object({ ${items.map((item) => `${item.key}: ${itemSchema(item)}`).join(", ")} })`
}

function fieldSchema(field: Field): string {
  const base = (() => {
    switch (field.kind) {
      case "integer":
        return "v.pipe(v.number(), v.integer())"
      case "number":
        return "v.number()"
      case "list":
        return `v.array(${objectSchema(field.items ?? [])})`
      case "object":
        return objectSchema(field.items ?? [])
      default:
        return "v.string()"
    }
  })()
  if (field.nullable) return `v.nullable(${base})`
  if (field.optional) return `v.optional(${base})`
  return base
}

function rowTypeOf(collection: Collection): string {
  const schema = `${collection.rowType}Row`
  return `export const ${schema} = v.object({\n${collection.fields.map((field) => `  ${field.key}: ${fieldSchema(field)},`).join("\n")}\n})\nexport type ${collection.rowType} = v.InferOutput<typeof ${schema}>`
}

/** The text of `generated/rows.ts`. */
export function rowTypesSource(): string {
  const types = COLLECTIONS.filter((collection) => collection.rowType).map(rowTypeOf)
  return `// Generated from the collection specs by \`npm run generate --workspace @designsystem/content\`. Never edit by hand.\n\nimport * as v from "valibot"\n\n${types.join("\n\n")}\n`
}
