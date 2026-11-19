import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"

import { rowTypesSource } from "./row-types.ts"

test("generated/rows.ts is what the specs say; run `npm run generate --workspace @designsystem/content`", () => {
  assert.equal(readFileSync(join(import.meta.dirname, "generated", "rows.ts"), "utf8"), rowTypesSource())
})
