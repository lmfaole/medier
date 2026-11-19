import { strict as assert } from "node:assert"
import { test } from "node:test"

import { commandLines, filesNamed, introOf, pagePath } from "./repo-map-plan.ts"

test("an Astro page answers the URL of its path; the 404 page and the API endpoints answer none", () => {
  assert.equal(pagePath("index.astro"), "/")
  assert.equal(pagePath("kilder.astro"), "/kilder")
  assert.equal(pagePath("film/[slug].astro"), "/film/[slug]")
  assert.equal(pagePath("bibliotek/index.astro"), "/bibliotek")
  assert.equal(pagePath("404.astro"), undefined)
  assert.equal(pagePath("api/[...file].ts"), undefined)
})

const agents = `# AGENTS.md — film

\`sky.lmfaole.party/apps/film\`: the films.

| Where | What |
| --- | --- |
| \`sync-rust/src/log.rs\` | The log |
| \`web/src/server/api.ts\`, \`snapshot.ts\` | the API |

Commands from \`apps/film\`: \`npm run snapshot\`.
Timers: daily.
`

test("the intro, the files and the command lines are read from AGENTS.md", () => {
  assert.equal(introOf(agents), "`sky.lmfaole.party/apps/film`: the films.")
  assert.deepEqual(filesNamed(agents), ["sync-rust/src/log.rs", "web/src/server/api.ts", "snapshot.ts"])
  assert.deepEqual(commandLines(agents), ["Commands from `apps/film`: `npm run snapshot`.", "Timers: daily."])
})
