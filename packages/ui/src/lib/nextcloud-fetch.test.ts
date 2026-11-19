import { strict as assert } from "node:assert"
import { test } from "node:test"

import { nextcloudFetch } from "./nextcloud-fetch.ts"

interface Call {
  url: string
  headers: Record<string, string>
  credentials: RequestCredentials | undefined
}

/** A fetch that answers from `script` in order and records what it was asked. */
function fake(script: (call: Call) => Response): { fetchFn: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  const fetchFn: typeof fetch = async (input, init) => {
    const call: Call = { url: String(input), headers: Object.fromEntries(new Headers(init?.headers)), credentials: init?.credentials }
    calls.push(call)
    return script(call)
  }
  return { fetchFn, calls }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

test("the token is fetched once, with the session, and sent with every request after it", async () => {
  const { fetchFn, calls } = fake((call) => (call.url === "/index.php/csrftoken" ? json({ token: "t1" }) : json({})))
  const nc = nextcloudFetch(fetchFn)
  await nc("/ocs/a")
  await nc("/ocs/b", { method: "POST", headers: { "Content-Type": "application/json" } })
  assert.deepEqual(calls.map((call) => call.url), ["/index.php/csrftoken", "/ocs/a", "/ocs/b"])
  assert.deepEqual(calls[1]?.headers, { requesttoken: "t1", "ocs-apirequest": "true" })
  assert.deepEqual(calls[2]?.headers, { requesttoken: "t1", "ocs-apirequest": "true", "content-type": "application/json" })
  assert.ok(calls.every((call) => call.credentials === "same-origin"))
})

test("a 412 is a stale token: a new one is fetched and the request is sent once more", async () => {
  let tokens = 0
  const { fetchFn, calls } = fake((call) => {
    if (call.url === "/index.php/csrftoken") return json({ token: `t${++tokens}` })
    return call.headers["requesttoken"] === "t1" ? json({}, 412) : json({ ok: true })
  })
  const response = await nextcloudFetch(fetchFn)("/ocs/a")
  assert.equal(response.status, 200)
  assert.deepEqual(calls.map((call) => call.headers["requesttoken"] ?? ""), ["", "t1", "", "t2"])
})

test("a token request that fails still lets the request go out, without a token, for Nextcloud to refuse", async () => {
  const { fetchFn, calls } = fake((call) => (call.url === "/index.php/csrftoken" ? json({}, 401) : json({}, 403)))
  const response = await nextcloudFetch(fetchFn)("/ocs/a")
  assert.equal(response.status, 403)
  assert.equal(calls[1]?.headers["requesttoken"], undefined)
})
