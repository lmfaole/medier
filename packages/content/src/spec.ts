/**
 * What a collection is: the one description the row schemas, the tables and the
 * validation all read, so they cannot disagree about a field. `key` is the key
 * of the row the apps read (and of its column).
 */

/** One part of a list's item or of an object. */
export interface Item {
  key: string
  title: string
  /** Defaults to a string. */
  kind?: "string" | "integer" | "boolean"
  nullable?: boolean
  /** The only values a string may have. */
  choices?: readonly string[]
}

export interface Field {
  key: string
  title: string
  kind: "string" | "integer" | "number" | "list" | "object"
  /** Always in the row, as `null` when empty. */
  nullable?: boolean
  /** Left out of the row when empty. */
  optional?: boolean
  /** The only values a string may have. */
  choices?: readonly string[]
  /** For `kind: "list"` (many) and `kind: "object"` (one): the parts of an item. */
  items?: readonly Item[]
}

/** Where else a collection's row is described, which the contract test holds the spec to. */
export type Contract =
  | {
      /** The ts-rs type generated from the Rust struct, repository-relative. */
      generated: string
      /** Keys the Rust side adds that nobody edits (a derived source, an id prefix). */
      derived?: readonly string[]
      /** The table the row lands in, when it is one table. */
      table?: { schema: string; name: string }
    }
  | {
      /** Data TypeScript owns, with no Rust or database: the valibot object that reads the row. */
      valibot: { module: string; export: string }
    }

/** The database file (`.data/<name>.db`, `db/<name>.sql`) a content collection lives in. */
export type ContentDatabase = "cv" | "site"

export interface Collection {
  /** The database its table is written to: one file per domain, never mixed. */
  database: ContentDatabase
  /** What an app asks `readContentFromDatabase` for; its table is this in snake case (`cvPosition` is `cv_position`). */
  type: string
  /** The name of the row's TypeScript type in `generated/rows.ts` (`Konto`), for what an app reads as rows. */
  rowType?: string
  /** One row of it, singular: «Position». */
  title: string
  /** Repository-relative JSON of sample rows: what the tests and the local seed use. */
  sample?: string
  /** Set when the sample is an object with one entry per collection (cv.json); unset for a root array. */
  section?: string
  /** One row, an object in the sample rather than a list. */
  singleton?: boolean
  /** The field whose value is the row's identity. */
  idField: string
  /** The field the rows are ordered by, then by `idField`. */
  orderField: string
  fields: readonly Field[]
  /** What holds the row shape besides the spec; unset for content whose row schema and types are generated from the spec (`rowType`). */
  contract?: Contract
}
