import { strict as assert } from "node:assert"
import { test } from "node:test"

import { checksumFor, newestInMajor, wantedMajor } from "./node-runtime-plan.ts"

test(".node-version names a major, with or without v and a minor and patch", () => {
  assert.equal(wantedMajor("24\n"), 24)
  assert.equal(wantedMajor("v24.11.1"), 24)
  assert.equal(wantedMajor("lts/*"), null)
})

test("the newest release of the major with this machine's build is picked, by number and not by text", () => {
  const releases = [
    { version: "v25.1.0", files: ["linux-x64"] },
    { version: "v24.9.0", files: ["linux-x64"] },
    { version: "v24.10.0", files: ["linux-x64"] },
    { version: "v24.11.0", files: ["osx-arm64-tar"] },
  ]
  assert.equal(newestInMajor(releases, 24, "linux-x64"), "v24.10.0")
  assert.equal(newestInMajor(releases, 26, "linux-x64"), null)
})

test("the checksum is the one listed for exactly that file", () => {
  const hash = "a".repeat(64)
  const shasums = `${"b".repeat(64)}  node-v24.10.0-linux-x64.tar.gz\n${hash}  node-v24.10.0-linux-x64.tar.xz\n`
  assert.equal(checksumFor(shasums, "node-v24.10.0-linux-x64.tar.xz"), hash)
  assert.equal(checksumFor(shasums, "node-v24.10.0-linux-arm64.tar.xz"), null)
})
