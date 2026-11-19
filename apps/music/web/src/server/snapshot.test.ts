import { strict as assert } from "node:assert"
import { test } from "node:test"

import { fakeD1 } from "@designsystem/config/worker-test-kit"
import { API } from "./api.ts"
import { snapshot } from "./snapshot.ts"

test("every file of the API has a request in the snapshot, or the deployed page asks for a file that is not there", async () => {
  const requests = await snapshot.requests(fakeD1(() => []))

  // The sheets are listed from the rows of the database, and an empty one has none. The concerts name venues, which are places, so they have no file in a snapshot.
  const missing = Object.keys(API).filter((name) => name !== "entity" && name !== "concerts").filter((name) => !requests.some((request) => request === `/api/${name}.json` || request.startsWith(`/api/${name}.json?`)))
  assert.deepEqual(missing, [])
  assert.deepEqual(requests.filter((request) => request.includes("concert")), [])
})
