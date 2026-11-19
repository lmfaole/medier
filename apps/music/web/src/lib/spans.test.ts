import { strict as assert } from "node:assert"
import { test } from "node:test"

import { changeSaid } from "./spans.ts"

test("the change is said against the one before, and not at all when it cannot be compared", () => {
  assert.equal(changeSaid(12, "måneden før"), "opp 12 % fra måneden før")
  assert.equal(changeSaid(-30, "året før"), "ned 30 % fra året før")
  assert.equal(changeSaid(0, "året før"), "like mange som året før")
  assert.equal(changeSaid(null, "året før"), "")
})
