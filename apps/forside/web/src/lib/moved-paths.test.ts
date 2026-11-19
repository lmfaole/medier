import { strict as assert } from "node:assert"
import { test } from "node:test"

import { movedTo } from "./moved-paths.ts"

test("an old path goes to where it moved, keeping what came after it", () => {
  assert.equal(movedTo("/media"), "/medier")
  assert.equal(movedTo("/alle-apper"), "/medier")
  assert.equal(movedTo("/musikk"), "https://sky.lmfaole.party/apps/medier/musikk/")
  assert.equal(movedTo("/musikk/charts"), "https://sky.lmfaole.party/apps/medier/musikk/charts")
  assert.equal(movedTo("/film/film/t10138-9fc97556"), "https://sky.lmfaole.party/apps/medier/film/film/t10138-9fc97556")
  assert.equal(movedTo("/podkast/charts"), "https://sky.lmfaole.party/apps/medier/podkast/charts")
})

test("every media app's address under /medier, and rss, lands on its new home", () => {
  assert.equal(movedTo("/medier/musikk/"), "https://sky.lmfaole.party/apps/medier/musikk/")
  assert.equal(movedTo("/medier/spill"), "https://sky.lmfaole.party/apps/medier/spill/")
  assert.equal(movedTo("/medier/boker/covers/x.jpg"), "https://sky.lmfaole.party/apps/medier/boker/covers/x.jpg")
  assert.equal(movedTo("/medier/brettspill/toppliste"), "https://sky.lmfaole.party/apps/medier/brettspill/toppliste")
  assert.equal(movedTo("/rss/toppsaker"), "https://sky.lmfaole.party/apps/medier/rss/toppsaker")
})

test("a path that never moved is left alone", () => {
  for (const pathname of ["/", "/medier", "/musikken", "/filmer", "/medier/musikkfest", "/rssfeed", "/about"]) assert.equal(movedTo(pathname), null, pathname)
})
