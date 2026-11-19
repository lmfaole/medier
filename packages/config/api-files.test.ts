import { strict as assert } from "node:assert"
import { beforeEach, test } from "node:test"

import { apiFiles } from "./api-files.ts"
import { assetsServing, getRoute, installEdgeCache } from "./worker-test-kit.ts"

beforeEach(() => {
  installEdgeCache()
})

test("every API file is served from the snapshot in the asset store", async () => {
  const assets = assetsServing(JSON.stringify({ person: "Ada" }), { headers: { "Content-Type": "application/json" } })
  const handler = apiFiles(() => ({ ASSETS: assets }))
  assert.deepEqual(await (await getRoute(handler, "/api/cv.json")).json(), { person: "Ada" })
  assert.deepEqual(assets.paths, ["/api/cv.json"])
})
