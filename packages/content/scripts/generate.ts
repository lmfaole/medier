import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { rowTypesSource } from "../src/row-types.ts"
import { CONTENT_DATABASES, contentSchemaSql } from "../src/tables.ts"

const here = join(import.meta.dirname, "..")
writeFileSync(join(here, "src", "generated", "rows.ts"), rowTypesSource())
console.log("wrote src/generated/rows.ts")

for (const name of CONTENT_DATABASES) {
  writeFileSync(join(here, "..", "..", "db", `${name}.sql`), contentSchemaSql(name))
  console.log(`wrote db/${name}.sql`)
}
