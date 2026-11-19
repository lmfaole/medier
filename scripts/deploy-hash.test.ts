import { strict as assert } from "node:assert"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { hashBuilt, hashedPaths, readHash, writeHash } from "./deploy-hash.ts"

function built(files: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), "deploy-hash-"))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(directory, path, ".."), { recursive: true })
    writeFileSync(join(directory, path), text)
  }
  return directory
}

test("the same files hash the same, a changed byte, name or Wrangler version does not", () => {
  const files = { "client/a.js": "one", "server/entry.mjs": "two" }
  const base = hashBuilt(built(files), "4.1")
  assert.equal(hashBuilt(built(files), "4.1"), base)
  assert.notEqual(hashBuilt(built({ ...files, "client/a.js": "One" }), "4.1"), base)
  assert.notEqual(hashBuilt(built({ "client/b.js": "one", "server/entry.mjs": "two" }), "4.1"), base)
  assert.notEqual(hashBuilt(built(files), "4.2"), base)
})

test("Wrangler's scratch folder and .dev.vars do not count", () => {
  const files = { "client/a.js": "one", "server/wrangler.json": "{}" }
  const plain = hashBuilt(built(files))
  assert.equal(hashBuilt(built({ ...files, "server/.wrangler/tmp/x.js": "scratch", "server/.dev.vars": "k=v" })), plain)
  assert.deepEqual(hashedPaths(["a", "server/.wrangler/tmp", "server/.dev.vars", "b"]), ["a", "b"])
})

test("a hash is read back as written, and a missing file is null", () => {
  const file = join(mkdtempSync(join(tmpdir(), "deploy-hash-")), "nested", "app.dist.sha256")
  assert.equal(readHash(file), null)
  writeHash(file, "abc")
  assert.equal(readHash(file), "abc")
})
