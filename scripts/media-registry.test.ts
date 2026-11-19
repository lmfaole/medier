import { strict as assert } from "node:assert"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"

import { APPS, HOME_APP_NAMES, MEDIA_APPS, SERVED_APPS } from "./apps.ts"
import { HOME_SPECS, MOVED_BASES, RETIRED_BASES, SPECS, TUNNEL_PATH_REGEX } from "./media-registry.ts"

const root = join(import.meta.dirname, "..")

test("every media app is in the registry, once, and the rest with pages stay Workers", () => {
  assert.deepEqual(SPECS.map((spec) => spec.name), [...MEDIA_APPS])
  assert.deepEqual(APPS.filter((app) => app.port !== undefined).map((app) => app.name).filter((name) => !SERVED_APPS.includes(name)), ["work", "forside"])
})

test("the base path of an app is the one its Astro config builds with, and every base is its own", () => {
  for (const spec of SPECS) {
    const config = readFileSync(join(root, "apps", spec.name, "web", "astro.config.ts"), "utf8")
    assert.match(config, new RegExp(`base: '${spec.base}/?'`), spec.name)
    assert.match(config, /runtime: 'node'/, spec.name)
  }
  const bases = SPECS.map((spec) => spec.base)
  assert.equal(new Set(bases).size, bases.length)
  assert.ok(bases.every((base) => base === "/apps/medier" || base.startsWith("/apps/medier/")), "every app is inside the installed app's scope")
  assert.ok(bases.every((base) => !base.endsWith("/")))
})

test("each app's old base leads to its base now, and none of them is inside the hub", () => {
  assert.equal(MOVED_BASES["/apps/film"], "/apps/medier/film")
  assert.equal(Object.keys(MOVED_BASES).length, SPECS.length - 1)
  assert.ok(Object.keys(MOVED_BASES).every((base) => !base.startsWith("/apps/medier")))
})

test("a media app has no Worker left: no wrangler.jsonc, no deploy script, no snapshot step in its build", () => {
  for (const name of MEDIA_APPS) {
    assert.equal(existsSync(join(root, "apps", name, "wrangler.jsonc")), false, name)
    assert.equal(existsSync(join(root, "apps", name, "web", "src", "server.ts")), false, name)
    const scripts: Record<string, string> = JSON.parse(readFileSync(join(root, "apps", name, "package.json"), "utf8")).scripts
    assert.equal(scripts["deploy"], undefined, name)
    assert.equal(scripts["snapshot"], undefined, name)
    assert.ok(!(scripts["build"] ?? "").includes("snapshot"), name)
  }
})

test("forside and work keep their Worker and their snapshot", () => {
  for (const name of ["forside", "work"]) {
    assert.ok(existsSync(join(root, "apps", name, "wrangler.jsonc")), name)
    const scripts: Record<string, string> = JSON.parse(readFileSync(join(root, "apps", name, "package.json"), "utf8")).scripts
    assert.ok(scripts["snapshot"] !== undefined && scripts["deploy"] !== undefined, name)
    assert.doesNotMatch(readFileSync(join(root, "apps", name, "web", "astro.config.ts"), "utf8"), /runtime: 'node'/)
  }
})

test("the home apps are mounted at the addresses their installed PWAs have, outside the media apps' scope, and are no media app", () => {
  assert.deepEqual(HOME_SPECS.map((spec) => [spec.name, spec.base]), [["innboks", "/apps/hjemmeserver/innboks"], ["hjem", "/apps/hjemmeserver/hjem"], ["miniflux", "/apps/hjemmeserver/miniflux"], ["penger", "/apps/hjemmeserver/penger"]])
  assert.deepEqual(HOME_SPECS.map((spec) => spec.name), [...HOME_APP_NAMES])
  const taken = new Set([...SPECS, ...HOME_SPECS].map((spec) => spec.base))
  assert.equal(taken.size, SPECS.length + HOME_SPECS.length)
  for (const spec of HOME_SPECS) {
    assert.ok(!MEDIA_APPS.includes(spec.name), spec.name)
    assert.ok(!spec.base.startsWith("/apps/medier"), spec.name)
    assert.ok(!spec.base.endsWith("/"), spec.name)
    assert.deepEqual(spec.moved, {})
  }
  // Nothing about the media apps moved: the old bases and the retired ones lead where they did.
  assert.ok(Object.values(MOVED_BASES).every((base) => base.startsWith("/apps/medier/")))
  assert.equal(RETIRED_BASES["/apps/rss"], "/apps/hjemmeserver/miniflux/")
})

test("the tunnel's one path rule matches every base the server answers, and nothing of Nextcloud's", () => {
  const rule = new RegExp(TUNNEL_PATH_REGEX)
  // cloudflared uses Go's RE2: no lookahead, no lookbehind, no backreference, no named group.
  assert.doesNotMatch(TUNNEL_PATH_REGEX, /\(\?|\\[1-9]/)
  const bases = [...SPECS, ...HOME_SPECS].map((spec) => spec.base)
  for (const base of [...bases, ...Object.keys(MOVED_BASES), ...Object.keys(RETIRED_BASES)]) {
    for (const path of [base, `${base}/`, `${base}/some/page?x=1`]) assert.match(path.split("?")[0] ?? "", rule, path)
  }
  // A home app that does not exist yet, and what Nextcloud's own pages of the app are: all the server's to route.
  for (const path of ["/apps/hjemmeserver/ny-app/", "/apps/hjemmeserver/api/miniflux/entries", "/apps/hjemmeserver/oversikt/", "/apps/hjemmeserver/sw.js"]) assert.match(path, rule, path)
  for (const path of ["/", "/remote.php/dav/files/ole/", "/index.php/login", "/status.php", "/apps/files/", "/apps/calendar/", "/apps/hjemmeserverx/", "/apps/medierx", "/apps/filmx/", "/apps/media", "/ocs/v2.php/apps/files", "/x/apps/film/", "/apps/"]) {
    assert.doesNotMatch(path, rule, path)
  }
})
