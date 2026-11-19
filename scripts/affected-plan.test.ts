import { strict as assert } from "node:assert"
import { test } from "node:test"

import { checksFor, shipTargets, unitsOf } from "./affected-plan.ts"
import { APPS } from "./apps.ts"

test("a file belongs to the app, package or script part it sits in; notes and data do not count", () => {
  const units = unitsOf(["apps/film/web/src/a.ts", "apps/tv/AGENTS.md", "packages/ui/src/a.ts", "scripts/x.ts", "docs/DATA.md", "db/film.sql", ".data/x.db"])
  assert.deepEqual(units.apps, ["film", "tv"])
  assert.deepEqual(units.packages, ["ui"])
  assert.equal(units.scripts, true)
  assert.deepEqual(units.other, ["db/film.sql"])
})

test("one app changed is checked alone; a package change is typechecked in every app", () => {
  const alone = checksFor(unitsOf(["apps/film/web/src/a.ts"])).map((check) => check.name)
  assert.deepEqual(alone, ["lint film", "typecheck film", "test"])
  const shared = checksFor(unitsOf(["packages/ui/src/a.ts"])).map((check) => check.name)
  assert.ok(["typecheck music", "typecheck forside", "typecheck ui"].every((name) => shared.includes(name)))
})

test("nothing to check when only notes changed", () => {
  assert.deepEqual(checksFor(unitsOf(["README.md"])), [])
})

test("ship deploys the apps that changed and only names shared code, until it is asked for", () => {
  assert.deepEqual(shipTargets(["apps/music/web/a.ts", "packages/ui/a.ts"], false), { deploy: [], media: ["music"], sharedChanged: ["packages/ui"] })
  assert.deepEqual(shipTargets(["apps/forside/web/a.ts", "apps/film/web/a.ts"], false), { deploy: ["forside"], media: ["film"], sharedChanged: [] })
  const everything = shipTargets(["packages/ui/a.ts"], true)
  assert.equal(everything.deploy.length + everything.media.length, APPS.filter((app) => app.port !== undefined).length)
  assert.deepEqual(everything.deploy, ["work", "forside"])
  assert.deepEqual(shipTargets(["docs/a.md"], false), { deploy: [], media: [], sharedChanged: [] })
})
