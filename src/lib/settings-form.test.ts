import { strict as assert } from "node:assert"
import { test } from "node:test"

import { formPrefs, planUsernames, settingsRedirect, shownSections, stepErrors, withoutSeen } from "./settings-form.ts"

const form = (entries: [string, string][]): FormData => {
  const data = new FormData()
  for (const [name, value] of entries) data.append(name, value)
  return data
}
const current = { theme: "system", effects: "on", tilt: "off" } as const

test("a form's choices replace the prefs, the rest are kept, and only valid values count", () => {
  assert.deepEqual(formPrefs({ ...current, sections: ["musikk"] }, form([["theme", "dark"], ["effects", "off"], ["tilt", "sideways"]])), { theme: "dark", effects: "off", tilt: "off", sections: ["musikk"] })
  assert.deepEqual(formPrefs(current, form([["theme", "purple"]])), current)
})

test("the sections are those ticked, in the front page's order; none ticked is none, and a form without the field leaves them be", () => {
  assert.deepEqual(formPrefs(current, form([["sections", ""], ["sections", "artister"], ["sections", "na"], ["sections", "reklame"]])).sections, ["na", "artister"])
  assert.deepEqual(formPrefs(current, form([["sections", ""]])).sections, [])
  assert.equal(formPrefs(current, form([["theme", "light"]])).sections, undefined)
})

test("the front page shows every section until some are chosen, and never one it does not know", () => {
  assert.deepEqual([...shownSections({})], ["na", "musikk", "film-og-tv", "artister"])
  assert.deepEqual([...shownSections({ sections: ["film-og-tv", "reklame"] })], ["film-og-tv"])
  assert.equal(shownSections({ sections: [] }).size, 0)
})

test("the usernames are checked with their service: kept when found, forgotten when emptied, said when not found, left when absent", async () => {
  const asked: string[] = []
  const plan = await planUsernames(form([["lastfm", " snowpony69 "], ["trakt", "nobody"]]), async (service, user) => {
    asked.push(`${service}:${user}`)
    return user !== "nobody"
  })
  assert.deepEqual(plan, { set: { lastfm: "snowpony69" }, clear: [], invalid: { trakt: "nobody" } })
  assert.deepEqual(asked.sort(), ["lastfm:snowpony69", "trakt:nobody"])
  assert.deepEqual(stepErrors(plan), { trakt: "Fant ingen offentlig profil som heter «nobody» på Trakt. Sjekk stavingen, og at profilen ikke er privat." })
  assert.deepEqual(await planUsernames(form([["lastfm", ""], ["trakt", "a b"]]), async () => true), { set: {}, clear: ["lastfm"], invalid: { trakt: "a b" } })
  assert.deepEqual(stepErrors(await planUsernames(form([["theme", "dark"]]), async () => false)), {})
})

test("back is clean when all was well, and to the field (in the wizard, its step) when a username was not found", () => {
  const none = { set: {}, clear: [], invalid: {} }
  assert.equal(settingsRedirect("/musikk/?forste-gang=lastfm&brukernavn-feil=lastfm&brukernavn-verdi=x", none, true), "/musikk/")
  assert.equal(settingsRedirect("/innstillinger/?lagret=1", { ...none, invalid: { lastfm: "x y" } }, false), "/innstillinger/?lagret=1&brukernavn-feil=lastfm&brukernavn-verdi=x+y")
  assert.equal(settingsRedirect("/", { ...none, invalid: { trakt: "z" } }, true), "/?brukernavn-feil=trakt&brukernavn-verdi=z&forste-gang=trakt#first-run-trakt")
})

test("«Vis introen igjen» takes the wizard out of seen, and nothing else", () => {
  assert.equal(withoutSeen("intro-musikk@1,first-run@1,install@1", "first-run"), "intro-musikk@1,install@1")
  assert.equal(withoutSeen(encodeURIComponent("first-run@2"), "first-run"), "")
  assert.equal(withoutSeen(undefined, "first-run"), "")
})
