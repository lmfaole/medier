import { strict as assert } from "node:assert"
import { test } from "node:test"

import { cookieDigest, createLoginGate, type LoginGateOptions } from "./login-gate.ts"

const HEADERS = { "X-Test": "1" }
const COOKIE = "nc_session_id=secret-session; other=1"

/** A Nextcloud that names `id` for the cookie above and counts the questions. */
function nextcloud(answer: (cookie: string) => Response | Promise<Response>): { fetchImpl: NonNullable<LoginGateOptions["fetchImpl"]>; asked: { url: string; headers: Headers }[] } {
  const asked: { url: string; headers: Headers }[] = []
  return {
    asked,
    fetchImpl: async (input, init) => {
      asked.push({ url: String(input), headers: new Headers(init?.headers) })
      return answer(new Headers(init?.headers).get("cookie") ?? "")
    },
  }
}

const user = (id: unknown) => Response.json({ ocs: { data: { id } } })
const page = (cookie?: string, path = "/apps/film/?x=1") =>
  new Request(`http://app.test${path}`, { headers: { ...(cookie === undefined ? {} : { cookie }), "sec-fetch-dest": "document" } })

test("the owner is let through", async () => {
  const { fetchImpl } = nextcloud(() => user("ole"))
  const gate = createLoginGate({ fetchImpl })
  assert.equal(await gate.check(page(COOKIE), page(COOKIE), HEADERS), undefined)
})

test("another account gets 403", async () => {
  const { fetchImpl } = nextcloud(() => user("anna"))
  const refused = await createLoginGate({ fetchImpl }).check(page(COOKIE), page(COOKIE), HEADERS)
  assert.equal(refused?.status, 403)
  assert.equal(refused?.headers.get("X-Test"), "1")
})

test("no cookie sends a page to the login with the way back, and a fetch gets 401, without asking Nextcloud", async () => {
  const { fetchImpl, asked } = nextcloud(() => user("ole"))
  const gate = createLoginGate({ fetchImpl })
  const redirect = await gate.check(page(), page(), HEADERS)
  assert.equal(redirect?.status, 302)
  assert.equal(redirect?.headers.get("Location"), `https://sky.lmfaole.party/login?redirect_url=${encodeURIComponent("/apps/film/?x=1")}`)
  const fetched = new Request("http://app.test/apps/film/api/x.json", { headers: { "sec-fetch-dest": "empty" } })
  assert.equal((await gate.check(fetched, fetched, HEADERS))?.status, 401)
  assert.equal(asked.length, 0)
})

test("a cookie Nextcloud does not know is anonymous", async () => {
  for (const status of [401, 403, 302]) {
    const { fetchImpl } = nextcloud(() => new Response(null, { status }))
    assert.equal((await createLoginGate({ fetchImpl }).check(page(COOKIE), page(COOKIE), HEADERS))?.status, 302, String(status))
  }
})

test("the gate fails closed when Nextcloud cannot say who it is", async () => {
  for (const answer of [() => new Response("no", { status: 500 }), () => user(42), () => Promise.reject(new Error("down"))]) {
    const { fetchImpl } = nextcloud(answer)
    const refused = await createLoginGate({ fetchImpl }).check(page(COOKIE), page(COOKIE), HEADERS)
    assert.equal(refused?.status, 503)
    assert.equal(refused?.headers.get("Retry-After"), "30")
  }
})

test("the verdict is kept for a minute under a digest, never the cookie", async () => {
  let time = 0
  const { fetchImpl, asked } = nextcloud(() => user("ole"))
  const gate = createLoginGate({ fetchImpl, now: () => time })
  await gate.check(page(COOKIE), page(COOKIE), HEADERS)
  time = 59_000
  await gate.check(page(COOKIE), page(COOKIE), HEADERS)
  assert.equal(asked.length, 1)
  assert.deepEqual(gate.verdictKeys(), [await cookieDigest(COOKIE)])
  assert.ok(!gate.verdictKeys().some((key) => key.includes("secret-session")))
  time = 61_000
  await gate.check(page(COOKIE), page(COOKIE), HEADERS)
  assert.equal(asked.length, 2)
})

test("an internal Nextcloud address is asked with the public name as Host and the owner id can be set", async () => {
  const { fetchImpl, asked } = nextcloud(() => user("kari"))
  const gate = createLoginGate({ fetchImpl, whoAmI: "http://nextcloud:80/ocs/v2.php/cloud/user?format=json", host: "sky.example", ownerId: "kari", loginOrigin: "https://login.example" })
  assert.equal(await gate.check(page(COOKIE), page(COOKIE), HEADERS), undefined)
  assert.equal(asked[0]?.url, "http://nextcloud:80/ocs/v2.php/cloud/user?format=json")
  assert.equal(asked[0]?.headers.get("host"), "sky.example")
  assert.equal(asked[0]?.headers.get("ocs-apirequest"), "true")
  const redirect = await createLoginGate({ fetchImpl, loginOrigin: "https://login.example" }).check(page(), page(), HEADERS)
  assert.match(redirect?.headers.get("Location") ?? "", /^https:\/\/login\.example\/login\?/)
})
