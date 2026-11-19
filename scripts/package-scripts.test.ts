import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const scripts: Record<string, string> = JSON.parse(readFileSync("package.json", "utf8")).scripts

test("a root script never runs itself: that is a fork bomb that takes the machine down", () => {
  for (const [name, command] of Object.entries(scripts)) {
    for (const part of command.split(/&&|;|\||"\s+"/)) {
      const run = part.trim().replace(/^"|"$/g, "").match(/^npm run (?:-s )?([\w:.-]+)(.*)$/)
      if (run === null || run[1] !== name) continue
      assert.match(run[2] ?? "", /--workspace|-w /, `"${name}" runs itself in the root`)
    }
  }
})
