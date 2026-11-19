import assert from "node:assert/strict"
import test from "node:test"

import { ANY_APPS, appSubPages, appTopPages, isAnyApp, APP_IDS, HOME_APP_IDS } from "./apps.ts"
import { breadcrumbTrail } from "./breadcrumbs.ts"
import { currentSection, listOfThings, registeredPage } from "./nav.ts"
import { switcherLinks } from "./switcher.ts"

const MUSIC = "/apps/medier/musikk/"
const HOME = "/apps/hjemmeserver/hjem/"
const labels = (trail: ReturnType<typeof breadcrumbTrail>) => trail.map(({ label, current }) => [label, current])

test("an app's navigation bar is its top-level pages, the front page first, and at most five (they must fit under an icon on a phone)", () => {
  for (const id of [...APP_IDS, ...HOME_APP_IDS]) {
    const top = appTopPages(id)
    assert.equal(top[0]?.to, "/", id)
    assert.ok(top.length <= 5, `${id} has ${top.length} top-level pages`)
    assert.ok(top.every((page) => page.under === undefined), id)
  }
  assert.deepEqual(appTopPages("hjem").map((page) => page.to), ["/", "/status", "/adguard", "/nett"])
  assert.deepEqual(appTopPages("music").map((page) => page.to), ["/", "/tilbakeblikk", "/historikk", "/bibliotek", "/konserter"])
})

test("a page lists the pages directly under it, and a page without subpages lists none", () => {
  assert.deepEqual(appSubPages("hjem", "/adguard").map((page) => page.to), ["/adguard/enheter", "/adguard/historikk", "/adguard/drift"])
  assert.deepEqual(appSubPages("music", "/tilbakeblikk").map((page) => page.to), ["/tilbakeblikk/uke", "/tilbakeblikk/maaned", "/tilbakeblikk/aar"])
  assert.deepEqual(appSubPages("music", "/historikk"), [])
  assert.deepEqual(appSubPages("film", "/"), [])
})

test("every page has an icon (a meaning of the design system), a label and a line of what is on it", () => {
  for (const id of [...APP_IDS, ...HOME_APP_IDS]) {
    for (const page of ANY_APPS[id].pages) {
      assert.match(page.icon, /^[a-z]+(?:-[a-z]+)*$/, `${id} ${page.to}`)
      assert.ok(page.label.length > 0 && page.description.length > 0, `${id} ${page.to}`)
    }
  }
})

test("the navigation marks the top-level page the visitor is in: a subpage marks the page it is under, the page of one thing the list of things", () => {
  assert.equal(currentSection("music", MUSIC, MUSIC), "/")
  assert.equal(currentSection("music", `${MUSIC}historikk`, MUSIC), "/historikk")
  assert.equal(currentSection("music", `${MUSIC}tilbakeblikk/uke`, MUSIC), "/tilbakeblikk")
  assert.equal(currentSection("music", `${MUSIC}konserter/venuer/`, MUSIC), "/konserter")
  assert.equal(currentSection("music", `${MUSIC}artist/radiohead`, MUSIC), "/bibliotek")
  assert.equal(currentSection("hjem", `${HOME}adguard/enheter`, HOME), "/adguard")
  assert.equal(currentSection("podkast", "/apps/medier/podkast/show/x", "/apps/medier/podkast/"), "/")
})

test("the list of things is the library where an app has one, else the front page", () => {
  assert.equal(listOfThings("music").to, "/bibliotek")
  assert.equal(listOfThings("film").to, "/")
  assert.equal(registeredPage("music", `${MUSIC}historikk/`, MUSIC)?.to, "/historikk")
  assert.equal(registeredPage("music", MUSIC, MUSIC), undefined)
})

test("a media app's trail starts at the hub and ends at the page; a subpage's goes through its parent", () => {
  assert.deepEqual(labels(breadcrumbTrail("music", MUSIC, MUSIC)), [["Medier", false], ["Musikk", true]])
  assert.deepEqual(labels(breadcrumbTrail("music", `${MUSIC}historikk`, MUSIC)), [["Medier", false], ["Musikk", false], ["Historikk", true]])
  assert.deepEqual(labels(breadcrumbTrail("music", `${MUSIC}tilbakeblikk/uke`, MUSIC)), [["Medier", false], ["Musikk", false], ["Tilbakeblikk", false], ["Uke for uke", true]])
})

test("the page of one thing is named last and hangs under the list of things", () => {
  assert.deepEqual(labels(breadcrumbTrail("music", `${MUSIC}artist/radiohead`, MUSIC, "Radiohead")), [["Medier", false], ["Musikk", false], ["Bibliotek", false], ["Radiohead", true]])
  assert.deepEqual(labels(breadcrumbTrail("film", "/apps/medier/film/film/alien", "/apps/medier/film/", "Alien")), [["Medier", false], ["Film", false], ["Alien", true]])
})

test("a home app's trail starts at the app, and its front page has a trail of one, which draws nothing", () => {
  assert.deepEqual(labels(breadcrumbTrail("hjem", HOME, HOME)), [["Hjem", true]])
  assert.deepEqual(labels(breadcrumbTrail("hjem", `${HOME}adguard/enheter`, HOME)), [["Hjem", false], ["AdGuard", false], ["Enheter", true]])
})

test("the home apps' front pages list the other home apps and the media hub, and not the app the visitor is in", () => {
  const links = switcherLinks("penger")
  assert.deepEqual(links.map((link) => link.label), ["Innboks", "Hjem", "RSS", "Penger", "Medier"])
  assert.deepEqual(links.filter((link) => link.current).map((link) => link.label), ["Penger"])
  assert.deepEqual(links.map((link) => link.href), ["/apps/hjemmeserver/innboks/", "/apps/hjemmeserver/hjem/", "/apps/hjemmeserver/miniflux/", "/apps/hjemmeserver/penger/", "/apps/medier/"])
  assert.ok(links.every((link) => /^[a-z]+$/.test(link.icon)))
})

test("a name is an app only if the registry has it", () => {
  assert.equal(isAnyApp("music"), true)
  assert.equal(isAnyApp("hjem"), true)
  assert.equal(isAnyApp("toString"), false)
  assert.equal(isAnyApp("nope"), false)
})
