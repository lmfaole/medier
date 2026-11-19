import { strict as assert } from "node:assert"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, test } from "node:test"

import { fileInside, serveStatic } from "./media-static.ts"

let root = ""
let outside = ""

beforeEach(() => {
  const parent = mkdtempSync(join(tmpdir(), "media-static-"))
  root = join(parent, "client")
  outside = join(parent, "secret.txt")
  mkdirSync(join(root, "_astro"), { recursive: true })
  mkdirSync(join(root, "posters"), { recursive: true })
  writeFileSync(join(root, "_astro", "app.abc123.js"), "console.log(1)")
  writeFileSync(join(root, "posters", "p.jpg"), "jpeg")
  writeFileSync(join(root, "robots.txt"), "User-agent: *")
  writeFileSync(join(root, ".hidden"), "x")
  writeFileSync(outside, "secret")
  symlinkSync(outside, join(root, "link.txt"))
})
afterEach(() => rmSync(join(root, ".."), { recursive: true, force: true }))

const get = (path: string, headers: Record<string, string> = {}, method = "GET") => serveStatic(root, path, new Request(`http://app.test${path}`, { method, headers }))

test("a name that leaves the folder, hides behind a dot or is not a path is not a file", () => {
  for (const path of ["/../secret.txt", "/_astro/../../secret.txt", "/%2e%2e/secret.txt", "/.hidden", "/_astro/.x", "/a%00b", "/%E0%A4%A", "/a\\b", "/", ""]) {
    assert.equal(fileInside(root, path), null, path)
  }
  assert.equal(fileInside(root, "/_astro/app.abc123.js"), join(root, "_astro", "app.abc123.js"))
})

test("a hashed script is kept by the browser for a year, with its type", async () => {
  const response = await get("/_astro/app.abc123.js")
  assert.equal(response?.status, 200)
  assert.equal(response?.headers.get("Content-Type"), "text/javascript; charset=utf-8")
  assert.equal(response?.headers.get("Cache-Control"), "public, max-age=31536000, immutable")
  assert.equal(await response?.text(), "console.log(1)")
})

test("a picture of the immutable kind is kept for a year, anything else is revalidated", async () => {
  assert.equal((await get("/posters/p.jpg"))?.headers.get("Cache-Control"), "public, max-age=31536000, immutable")
  assert.equal((await get("/robots.txt"))?.headers.get("Cache-Control"), "public, max-age=0, must-revalidate")
})

test("a file that is unchanged is a 304, by its ETag or its date", async () => {
  const first = await get("/robots.txt")
  const etag = first?.headers.get("ETag") ?? ""
  assert.equal((await get("/robots.txt", { "If-None-Match": etag }))?.status, 304)
  assert.equal((await get("/robots.txt", { "If-None-Match": '"other"' }))?.status, 200)
  assert.equal((await get("/robots.txt", { "If-Modified-Since": first?.headers.get("Last-Modified") ?? "" }))?.status, 304)
})

test("HEAD has the length and no body; a missing file, a folder and a link out of the folder are not served as files", async () => {
  const head = await get("/robots.txt", {}, "HEAD")
  assert.equal(head?.headers.get("Content-Length"), "13")
  assert.equal(await head?.text(), "")
  assert.equal(await get("/nope.js"), null)
  assert.equal(await get("/_astro"), null)
  assert.equal(await get("/.hidden"), null)
})
