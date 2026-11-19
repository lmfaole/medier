import { strict as assert } from "node:assert"
import { test } from "node:test"

import { originalRequest, withBasePath, withoutBasePath } from "./base-path.ts"
import type { WorkerEnv, WorkerHandler } from "./worker-app.ts"

function recorder() {
  const seen: Request[] = []
  const app: WorkerHandler<WorkerEnv> = {
    async fetch(request) {
      seen.push(request)
      return new Response("ok")
    },
  }
  return { seen, app }
}

const call = (app: WorkerHandler<WorkerEnv>, path: string) =>
  app.fetch(new Request(`https://home.test${path}`), { ASSETS: { fetch: async () => new Response() } })

test("a request under the prefix reaches the app without it, and keeps its query", async () => {
  const { seen, app } = recorder()
  const response = await call(withBasePath(app, "/music/"), "/music/api/x.json?a=1")
  assert.equal(response.status, 200)
  assert.equal(new URL(seen[0]?.url ?? "").pathname, "/api/x.json")
  assert.equal(new URL(seen[0]?.url ?? "").search, "?a=1")
})

test("the request as received is still there for whoever needs the prefix", async () => {
  const { seen, app } = recorder()
  await call(withBasePath(app, "/music/"), "/music/charts")
  const received = seen[0]
  assert.ok(received)
  assert.equal(new URL(originalRequest(received).url).pathname, "/music/charts")
})

test("the bare prefix goes to its slash, and anything else outside it is a 404", async () => {
  const { seen, app } = recorder()
  const mounted = withBasePath(app, "/music/")
  const bare = await call(mounted, "/music?x=1")
  assert.equal(bare.status, 308)
  assert.equal(bare.headers.get("Location"), "https://home.test/music/?x=1")
  assert.equal((await call(mounted, "/dashboard/")).status, 404)
  assert.equal((await call(mounted, "/musical")).status, 404)
  assert.equal(seen.length, 0)
})

test("the base is cut from a path under it, and from nothing else", () => {
  const cut = (path: string, base: string) => new URL(withoutBasePath(new Request(`https://home.test${path}`), base).url).pathname
  assert.equal(cut("/apps/musikk/api/charts.json?period=2024", "/apps/musikk/"), "/api/charts.json")
  assert.equal(cut("/api/charts.json", "/"), "/api/charts.json")
  assert.equal(cut("/apps/musikkfest/api/x.json", "/apps/musikk/"), "/apps/musikkfest/api/x.json")
})
