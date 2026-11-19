import { strict as assert } from "node:assert"
import { test } from "node:test"

import { HOME_APP_NAMES, HOME_APPS_BUILT, MEDIA_APPS, partitionByScript, SERVED_APPS } from "./apps.ts"

test("partitionByScript splits apps by whether they have the script", () => {
  assert.deepEqual(partitionByScript(["a", "b", "c"], (app) => app !== "b"), { run: ["a", "c"], skipped: ["b"] })
})

test("the home apps live in the private repository: none is built here, and the media server serves only the media apps", () => {
  assert.deepEqual(HOME_APPS_BUILT, [])
  assert.ok(HOME_APPS_BUILT.every((name) => HOME_APP_NAMES.includes(name) && SERVED_APPS.includes(name)))
  assert.deepEqual(SERVED_APPS, [...MEDIA_APPS, ...HOME_APPS_BUILT])
  assert.ok(!SERVED_APPS.includes("work") && !SERVED_APPS.includes("forside"))
})
