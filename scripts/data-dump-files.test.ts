import { strict as assert } from "node:assert"
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { CHUNK_BYTES } from "./data-dump-plan.ts"
import { dumpRoot, readDump, writeDump } from "./data-dump-files.ts"

const table = (rows: number, width = 1) => `${['["id","text"]', ...Array.from({ length: rows }, (_, index) => `[${index},"${"x".repeat(width)}"]`)].join("\n")}\n`

test("the dump goes to DATA_DUMP_DIR when it is set, and to the ignored data-dump/ here when not", () => {
  assert.equal(dumpRoot("/repo", {}), "/repo/data-dump")
  assert.equal(dumpRoot("/repo", { DATA_DUMP_DIR: "/home/me/data" }), "/home/me/data")
  assert.equal(dumpRoot("/repo", { DATA_DUMP_DIR: "../data" }), "/data")
})

test("a table that outgrows one file becomes a folder of chunks and back, a dropped table goes, and what is read is what was written", () => {
  const directory = mkdtempSync(join(tmpdir(), "dump-"))
  try {
    writeDump(directory, new Map([["small", table(3)], ["gone", table(2)]]))
    assert.deepEqual(readdirSync(directory).toSorted(), ["gone.jsonl", "small.jsonl"])
    // Wide enough rows to pass the size of one file.
    const big = table(Math.ceil(CHUNK_BYTES / 900) + 10, 1000)
    writeDump(directory, new Map([["small", big]]))
    assert.deepEqual(readdirSync(directory), ["small"])
    assert.equal(readDump(directory).get("small"), big)
    writeDump(directory, new Map([["small", table(3)]]))
    assert.deepEqual(readdirSync(directory), ["small.jsonl"])
    assert.equal(existsSync(join(directory, "small")), false)
    assert.equal(readDump(directory).get("small"), table(3))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
