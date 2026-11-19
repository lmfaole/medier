import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { APP_IDS, appMountPath, HOME_APP_IDS } from "./apps.ts"
import { RETIRED_SCOPES } from "./hub.ts"
import { appManifest, HOME_SURFACE, pwaManifest } from "./pwa-manifest.ts"

test("the installed app owns the hub's mount, and every media app and icon is inside it", () => {
  const manifest = pwaManifest()
  assert.equal(manifest.scope, "/apps/medier/")
  assert.equal(manifest.start_url, manifest.scope)
  for (const id of APP_IDS) assert.ok(`${appMountPath(id)}/`.startsWith(manifest.scope), `${id} is mounted outside the installed app`)
  assert.deepEqual(manifest.shortcuts.map((shortcut) => shortcut.url), APP_IDS.map((id) => `${appMountPath(id)}/`))
  assert.ok([...manifest.icons, ...manifest.shortcuts.flatMap((shortcut) => shortcut.icons)].every((icon) => icon.src.startsWith(manifest.scope)))
  assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable" && icon.sizes === "512x512"))
})

test("no retired scope is inside the installed app, or a page would unregister its own worker", () => {
  for (const scope of RETIRED_SCOPES) assert.ok(!scope.startsWith(pwaManifest().scope), scope)
})

/** What `PageController::manifest` of the Nextcloud app gave each app, which the installed copies hold: `name`, `description`, address. */
const NEXTCLOUD_MANIFESTS = {
  innboks: { name: "Innboks", description: "Del filer til din egen Nextcloud." },
  hjem: { name: "Hjem", description: "Status, AdGuard og nettet hjemme." },
  miniflux: { name: "RSS", description: "Dagens briefing og loggen fra Miniflux." },
  penger: { name: "Penger", description: "Abonnementer og økonomi." },
} as const

test("a home app's manifest is the one its installed copies have: same name, address, scope and colours, and its identity is its start address", () => {
  for (const id of HOME_APP_IDS) {
    const manifest = appManifest(id)
    const start = `/apps/hjemmeserver/${id}/`
    assert.deepEqual([manifest.id, manifest.start_url, manifest.scope], [start, start, start], id)
    assert.deepEqual([manifest.name, manifest.short_name, manifest.description], [NEXTCLOUD_MANIFESTS[id].name, NEXTCLOUD_MANIFESTS[id].name, NEXTCLOUD_MANIFESTS[id].description], id)
    assert.deepEqual([manifest.lang, manifest.display, manifest.background_color, manifest.theme_color], ["nb", "standalone", "#ffffff", "#ffffff"], id)
    assert.equal(HOME_SURFACE, "#ffffff")
    assert.deepEqual(manifest.icons.map((icon) => [icon.sizes, icon.purpose]), [["192x192", "any"], ["512x512", "any"], ["512x512", "maskable"]], id)
    assert.ok(manifest.icons.every((icon) => icon.src.startsWith(`${appMountPath(id)}/pwa/`)), "the icons are inside the scope")
    assert.equal(manifest.shortcuts, undefined, "a home app has no shortcuts, it is not a hub")
  }
})

test("innboks is the one share target, a multipart POST of files to its own /share; the hub's manifest has none", () => {
  assert.deepEqual(appManifest("innboks").share_target, {
    action: "/apps/hjemmeserver/innboks/share",
    method: "POST",
    enctype: "multipart/form-data",
    params: { files: [{ name: "files", accept: ["*/*"] }] },
  })
  for (const id of HOME_APP_IDS.filter((candidate) => candidate !== "innboks")) assert.equal(appManifest(id).share_target, undefined, id)
  assert.equal(pwaManifest().share_target, undefined)
})

test("no home app's scope is inside the hub's, or the hub's worker would take its requests", () => {
  for (const id of HOME_APP_IDS) assert.ok(!appManifest(id).scope.startsWith(pwaManifest().scope), id)
})

test("the manifest link carries the credentials of the Cloudflare Access login, for the hub's manifest and for a home app's", () => {
  const document = readFileSync(new URL("../layouts/Document.astro", import.meta.url), "utf8")
  const link = document.split("\n").find((line) => line.includes('rel="manifest"')) ?? ""
  assert.match(link, /crossorigin="use-credentials"/)
  assert.match(link, /pwa === 'app'/)
})
