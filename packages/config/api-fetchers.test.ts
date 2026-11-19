import { strict as assert } from "node:assert"
import { test } from "node:test"

import { apiFetcherFor, registerApiFetcher } from "./api-fetchers.ts"

const fetcher = (name: string): Fetcher => ({ fetch: async () => new Response(name) })

test("a fetcher is found by the base path, with or without the trailing slash", async () => {
  registerApiFetcher("/apps/test-film/", fetcher("film"))
  registerApiFetcher("/apps/test-tv", fetcher("tv"))
  assert.equal(await (await apiFetcherFor("/apps/test-film").fetch(new Request("http://x.test/"))).text(), "film")
  assert.equal(await (await apiFetcherFor("/apps/test-tv/").fetch(new Request("http://x.test/"))).text(), "tv")
})

test("an app nobody registered has no fetcher, and says which", () => {
  assert.throws(() => apiFetcherFor("/apps/test-unknown"), /no API fetcher is registered for \/apps\/test-unknown/)
})
