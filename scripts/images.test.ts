import { strict as assert } from "node:assert"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { downloadImage, type Fetcher, imagesNamedIn, landImages, type Upstream } from "./images.ts"

const A = "/covers/f1418001-7f1e-46af-bfdb-95faeded8841/1-250.jpg"
const B = "/covers/f1418001-7f1e-46af-bfdb-95faeded8841/2-250.jpg"
const bytes = (text: string) => new TextEncoder().encode(text)
const find = (text: string) => [...text.matchAll(/\/covers\/[0-9a-f-]{36}\/\d+-250\.jpg/g)].map((match) => match[0])
const upstream: Upstream = (path) => (/^\/covers\/[0-9a-f-]{36}\/(\d+)-250\.jpg$/.exec(path) ? { url: `https://source.test/${path.split("/").at(-1)}`, headers: {} } : null)
const PREFIX = "/covers/"

const answering = (statuses: Record<string, number>, calls: string[] = []): Fetcher => async (url) => {
  calls.push(url)
  const status = statuses[(url.split("/").at(-1) ?? "").split("-")[0] ?? ""] ?? 200
  return { ok: status === 200, status, bytes: async () => bytes("jpeg") }
}

test("the covers a snapshot names are the distinct ones in its JSON files, however deep", () => {
  const directory = mkdtempSync(join(tmpdir(), "covers-"))
  mkdirSync(join(directory, "entity"))
  writeFileSync(join(directory, "recent.json"), JSON.stringify({ a: A, b: A }))
  writeFileSync(join(directory, "entity", "x.json"), JSON.stringify({ a: B }))
  assert.deepEqual(imagesNamedIn(directory, find), [A, B])
  assert.deepEqual(imagesNamedIn(join(directory, "nothing"), find), [])
})

test("a cover is tried again after a failure, and not after a 404", async () => {
  const calls: string[] = []
  const waited: number[] = []
  const flaky: Fetcher = async () => {
    calls.push("try")
    return calls.length < 3 ? { ok: false, status: 500, bytes: async () => bytes("") } : { ok: true, status: 200, bytes: async () => bytes("jpeg") }
  }
  assert.deepEqual(await downloadImage(A, flaky, upstream, 3, async (ms) => void waited.push(ms)), bytes("jpeg"))
  assert.deepEqual(waited, [1000, 2000])
  const gone: Fetcher = async () => ({ ok: false, status: 404, bytes: async () => bytes("") })
  assert.equal(await downloadImage(A, gone, upstream, 3, async () => {}), null)
  assert.equal(await downloadImage("/covers/nope/1-250.jpg", flaky, upstream), null)
})

test("landing keeps what it has, fetches what is missing once, and ships only what the snapshot names", async () => {
  const root = mkdtempSync(join(tmpdir(), "covers-"))
  const store = join(root, "store")
  const target = join(root, "public", "covers")
  const kept = join(store, A.replace(/^\/covers\//, ""))
  mkdirSync(join(kept, ".."), { recursive: true })
  writeFileSync(kept, "original")
  const stale = join(target, "old", "9-250.jpg")
  mkdirSync(join(stale, ".."), { recursive: true })
  writeFileSync(stale, "no longer named")

  const calls: string[] = []
  const result = await landImages({ named: [A, B], prefix: PREFIX, store, target, fetcher: answering({}, calls), upstream })

  assert.deepEqual({ landed: result.landed, kept: result.kept, missing: result.missing }, { landed: 1, kept: 1, missing: [] })
  assert.equal(calls.length, 1)
  assert.equal(readFileSync(kept, "utf8"), "original")
  assert.equal(readFileSync(join(target, A.replace(/^\/covers\//, "")), "utf8"), "original")
  assert.ok(existsSync(join(target, B.replace(/^\/covers\//, ""))))
  assert.equal(existsSync(stale), false)
})

test("a cover the archive does not give is reported and left out, and the rest still land", async () => {
  const root = mkdtempSync(join(tmpdir(), "covers-"))
  const result = await landImages({ named: [A, B], prefix: PREFIX, store: join(root, "s"), target: join(root, "t"), fetcher: answering({ "1": 404 }), upstream })
  assert.deepEqual(result.missing, [A])
  assert.equal(result.landed, 1)
  assert.ok(existsSync(join(root, "t", B.replace(/^\/covers\//, ""))))
  assert.equal(existsSync(join(root, "t", A.replace(/^\/covers\//, ""))), false)
})

test("a landed picture is a link to the stored one, and a second run leaves it alone", async () => {
  const root = mkdtempSync(join(tmpdir(), "covers-"))
  const store = join(root, "s")
  const target = join(root, "t")
  await landImages({ named: [A], prefix: PREFIX, store, target, fetcher: answering({}), upstream })
  const stored = join(store, A.replace(/^\/covers\//, ""))
  const shipped = join(target, A.replace(/^\/covers\//, ""))
  assert.equal(statSync(shipped).ino, statSync(stored).ino)
  const before = statSync(shipped).ctimeMs
  await landImages({ named: [A], prefix: PREFIX, store, target, fetcher: answering({}), upstream })
  assert.equal(statSync(shipped).ctimeMs, before)
})

test("a picture that failed every attempt is not asked for again at once", async () => {
  const root = mkdtempSync(join(tmpdir(), "covers-"))
  const calls: string[] = []
  const broken: Fetcher = async (url) => {
    calls.push(url)
    return { ok: false, status: 500, bytes: async () => bytes("") }
  }
  const options = { named: [A], prefix: PREFIX, store: join(root, "s"), target: join(root, "t"), upstream }
  const first = await landImages({ ...options, fetcher: broken })
  const asked = calls.length
  const second = await landImages({ ...options, fetcher: broken })
  assert.deepEqual([first.missing, second.missing], [[A], [A]])
  assert.equal(calls.length, asked)
})
