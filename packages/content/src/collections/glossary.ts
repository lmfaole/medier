import type { Collection } from "../spec.ts"

export const GLOSSARY_TERMS: Collection = {
  type: "glossaryTerm",
  database: "site",
  title: "Glossary term",
  sample: "packages/ui/src/lib/glossary.json",
  idField: "id",
  orderField: "id",
  contract: { valibot: { module: "packages/ui/src/lib/glossary.ts", export: "GlossaryRow" } },
  fields: [
    { key: "id", title: "Id", kind: "string" },
    { key: "term", title: "Term", kind: "string" },
    { key: "url", title: "Address", kind: "string" },
  ],
}
