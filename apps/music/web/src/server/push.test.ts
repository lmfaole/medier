import { strict as assert } from "node:assert"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { handlePush, readDevices } from "./push.ts"

const ENDPOINT = "https://push.example/send/abc123"
const device = (over: Record<string, unknown> = {}) => ({ endpoint: ENDPOINT, keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA", auth: "tBHItJI5svbpez7KI4CCXg" }, topics: ["week"], ...over })
const post = (action: string, body: unknown, headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) =>
  new Request(`http://music.local/push/${action}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) })
const at = (action: string) => new URL(`http://music.local/push/${action}`)

function directory(): string {
  return mkdtempSync(join(tmpdir(), "push-"))
}

test("a device is kept once by its address, and asking again replaces its topics", async () => {
  const dir = directory()
  assert.equal((await handlePush(post("subscribe", device()), at("subscribe"), dir))?.status, 204)
  assert.equal((await handlePush(post("subscribe", device({ topics: ["week", "month"] })), at("subscribe"), dir))?.status, 204)
  assert.deepEqual(readDevices(dir).map((entry) => entry.topics), [["week", "month"]])
  rmSync(dir, { recursive: true })
})

test("unsubscribing removes the device", async () => {
  const dir = directory()
  await handlePush(post("subscribe", device()), at("subscribe"), dir)
  assert.equal((await handlePush(post("unsubscribe", { endpoint: ENDPOINT }), at("unsubscribe"), dir))?.status, 204)
  assert.deepEqual(readDevices(dir), [])
  rmSync(dir, { recursive: true })
})

test("only the app's own pages may ask, and only with a device that is what a browser gives", async () => {
  const dir = directory()
  assert.equal((await handlePush(post("subscribe", device(), {}), at("subscribe"), dir))?.status, 403)
  assert.equal((await handlePush(post("subscribe", device(), { "sec-fetch-site": "cross-site" }), at("subscribe"), dir))?.status, 403)
  for (const bad of [device({ endpoint: "http://push.example/x" }), device({ topics: [] }), device({ topics: ["day"] }), device({ keys: { p256dh: "<script>", auth: "x" } }), "{not json"]) {
    assert.equal((await handlePush(post("subscribe", bad), at("subscribe"), dir))?.status, 400)
  }
  assert.equal((await handlePush(post("subscribe", "x".repeat(5000)), at("subscribe"), dir))?.status, 413)
  assert.deepEqual(readDevices(dir), [])
  rmSync(dir, { recursive: true })
})

test("at most ten devices are kept, and a path that is not one of these is left alone", async () => {
  const dir = directory()
  for (let index = 0; index < 10; index++) await handlePush(post("subscribe", device({ endpoint: `${ENDPOINT}${index}` })), at("subscribe"), dir)
  assert.equal((await handlePush(post("subscribe", device({ endpoint: `${ENDPOINT}x` })), at("subscribe"), dir))?.status, 409)
  assert.equal((await handlePush(post("subscribe", device({ endpoint: `${ENDPOINT}3`, topics: ["month"] })), at("subscribe"), dir))?.status, 204)
  assert.equal(await handlePush(new Request("http://music.local/tilbakeblikk"), new URL("http://music.local/tilbakeblikk"), dir), undefined)
  rmSync(dir, { recursive: true })
})

test("the public key is served when the sender has written it, and a file that is not a list is no devices", async () => {
  const dir = directory()
  assert.equal((await handlePush(new Request("http://music.local/push/key"), at("key"), dir))?.status, 404)
  writeFileSync(join(dir, "vapid-public-key.txt"), "BPublicKey\n")
  const key = await handlePush(new Request("http://music.local/push/key"), at("key"), dir)
  assert.equal(await key?.text(), "BPublicKey")
  writeFileSync(join(dir, "subscriptions.json"), '{"a":1}')
  assert.deepEqual(readDevices(dir), [])
  assert.equal(readFileSync(join(dir, "vapid-public-key.txt"), "utf8"), "BPublicKey\n")
  rmSync(dir, { recursive: true })
})
