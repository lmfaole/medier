import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { APPS as SCRIPT_APPS, HOME_APP_NAMES, HUB_APP, PUBLIC_APPS } from "../../../../scripts/apps.ts"
import { ANY_APPS, APP_IDS, APPS, appMountPath, appNavLabel, appsInGroup, HOME_APP_IDS, HOME_APPS, isHomeApp, listApps, pageHref } from "./apps.ts"
import { HUB } from "./hub.ts"

test("music is the path /apps/medier/musikk of sky.lmfaole.party", () => {
  assert.equal(APPS.music.href, "https://sky.lmfaole.party/apps/medier/musikk/")
})

test("a page of another app is a URL on that app's origin", () => {
  assert.equal(pageHref("https://sky.lmfaole.party/apps/medier/musikk/", "/charts"), "https://sky.lmfaole.party/apps/medier/musikk/charts")
  assert.equal(pageHref("https://sky.lmfaole.party/apps/medier/musikk", "/charts"), "https://sky.lmfaole.party/apps/medier/musikk/charts")
  assert.equal(pageHref("http://localhost:5176/apps/medier/musikk/", "/charts"), "http://localhost:5176/apps/medier/musikk/charts")
  assert.equal(pageHref("https://sky.lmfaole.party/apps/medier/musikk/", "/"), "https://sky.lmfaole.party/apps/medier/musikk/")
})

test("the registry and scripts/apps.ts list the same personal apps on the same ports, and a public app is in no registry", () => {
  assert.deepEqual(
    listApps().map((app) => [app.id, app.devPort]).toSorted(),
    SCRIPT_APPS.filter((app) => app.port !== undefined && !PUBLIC_APPS.includes(app.name) && app.name !== HUB_APP && !HOME_APP_NAMES.includes(app.name)).map((app) => [app.name, app.port]).toSorted(),
  )
  assert.equal(SCRIPT_APPS.find((app) => app.name === HUB_APP)?.port, HUB.devPort)
  for (const name of PUBLIC_APPS) assert.ok(!APP_IDS.some((id) => id === name), `${name} is public and must not be in the personal registry`)
})


test("the home apps keep the addresses the installed PWAs have, and are no media app", () => {
  assert.deepEqual(HOME_APP_IDS.map((id) => appMountPath(id)), ["/apps/hjemmeserver/innboks", "/apps/hjemmeserver/hjem", "/apps/hjemmeserver/miniflux", "/apps/hjemmeserver/penger"])
  assert.equal(HOME_APPS.miniflux.label, "RSS")
  const media: readonly string[] = APP_IDS
  for (const id of HOME_APP_IDS) assert.ok(!media.includes(id), `${id} is a home app, not a media app`)
  assert.deepEqual(appsInGroup("home").map((app) => app.id), [...HOME_APP_IDS])
  assert.deepEqual(appsInGroup("media").map((app) => app.id), [...APP_IDS])
  assert.ok(isHomeApp("penger") && !isHomeApp("music"))
  assert.equal(appNavLabel("miniflux"), "Sider i RSS")
  assert.equal(appNavLabel("hjem"), "Sider i hjem")
})

test("every app of either kind has its own dev port, and a front page that its subpages hang under", () => {
  assert.equal(new Set(Object.values(ANY_APPS).map((app) => app.devPort)).size, Object.keys(ANY_APPS).length)
  // A home app with a workspace is in scripts/apps.ts, on the port of the registry; one without is on no port yet.
  for (const id of HOME_APP_IDS) assert.ok(SCRIPT_APPS.every((app) => (app.name === id) === (app.port === HOME_APPS[id].devPort)), `${id}'s dev port belongs to another app`)
  for (const id of HOME_APP_IDS) {
    const paths: readonly string[] = HOME_APPS[id].pages.map((page) => page.to)
    assert.ok(paths.includes("/"), id)
    assert.equal(new Set(paths).size, paths.length, id)
    for (const page of HOME_APPS[id].pages) if ("under" in page) assert.ok(paths.includes(page.under), `${id} ${page.to} hangs under a page that does not exist`)
  }
})

test("a home app's colour is the hue its Nextcloud predecessor had, in both themes, and `data-app` sets it", () => {
  const css = readFileSync(new URL("../theme.css", import.meta.url), "utf8")
  for (const id of HOME_APP_IDS) {
    const { hue } = HOME_APPS[id]
    assert.ok(css.includes(`--app-${id}: oklch(0.5 0.14 ${hue});`), `${id} light`)
    assert.ok(css.includes(`--app-${id}: oklch(0.78 0.12 ${hue});`), `${id} dark`)
    assert.ok(css.includes(`[data-app="${id}"] {\n    --app-color: var(--app-${id});`), `${id} data-app`)
  }
  assert.deepEqual(HOME_APP_IDS.map((id) => HOME_APPS[id].hue), [275, 230, 45, 165])
})
