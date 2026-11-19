import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { SETTINGS } from "./settings.ts"

test("the workflow hands every setting to the fetch, a secret as a secret and a variable as a variable", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/site.yml", import.meta.url), "utf8")
  for (const setting of SETTINGS) {
    const source = setting.kind === "secret" ? "secrets" : "vars"
    assert.ok(workflow.includes(`${setting.name}: \${{ ${source}.${setting.name} }}`), `${setting.name} from ${source}`)
  }
})
