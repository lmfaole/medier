import { strict as assert } from "node:assert"
import { test } from "node:test"

import { formerHostRedirect } from "./former-host.ts"

test("the former host sends on to the same path under /cv", () => {
  assert.equal(formerHostRedirect(new URL("https://jobb.lmfaole.party/")), "https://lmfaole.party/cv/")
  assert.equal(formerHostRedirect(new URL("https://jobb.lmfaole.party/api/cv.json?x=1")), "https://lmfaole.party/cv/api/cv.json?x=1")
})

test("any other host is left alone", () => {
  assert.equal(formerHostRedirect(new URL("https://lmfaole.party/cv/")), null)
})
