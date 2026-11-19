import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"

import { COLLECTIONS } from "./collections.ts"
import { APP_IDS, appsInGroup, listApps } from "../../ui/src/lib/apps.ts"
import { APPS_WITH_LABELS, PAGE_IDS } from "./collections/site.ts"
import { generatedFields } from "./contracts.ts"

const root = join(import.meta.dirname, "..", "..", "..")
const read = (file: string) => readFileSync(join(root, file), "utf8")

test("every collection is the shape of the type that owns its row", async () => {
  for (const collection of COLLECTIONS) {
    const keys = collection.fields.map((field) => field.key)
    const { contract } = collection
    // Content whose row schema and types are generated from the spec has nothing to be held to.
    if (contract === undefined) continue

    if ("valibot" in contract) {
      const schema = (await import(join(root, contract.valibot.module)))[contract.valibot.export]
      assert.deepEqual([...keys].toSorted(), Object.keys(schema.entries).toSorted(), `${collection.type}: keys of ${contract.valibot.export}`)
      for (const field of collection.fields) {
        assert.equal(Boolean(field.optional), schema.entries[field.key]?.type === "optional", `${collection.type}.${field.key}: optional in the spec and in ${contract.valibot.export}`)
      }
      continue
    }

    const generated = generatedFields(read(contract.generated))
    const derived = contract.derived ?? []
    assert.deepEqual(
      keys.filter((key) => !generated.has(key)),
      [],
      `${collection.type}: keys the Rust type ${contract.generated} does not have`,
    )
    assert.deepEqual(
      [...generated.keys()].filter((key) => !keys.includes(key) && !derived.includes(key)),
      [],
      `${collection.type}: fields of the Rust type that the spec neither edits nor lists as derived`,
    )
    for (const field of collection.fields) {
      const rust = generated.get(field.key)
      if (rust && !rust.nullable) {
        assert.equal(Boolean(field.nullable), false, `${collection.type}.${field.key} may be null in the spec but not in Rust`)
        assert.equal(Boolean(field.optional) && !rust.optional, false, `${collection.type}.${field.key} may be absent in the spec but not in Rust`)
      }
    }
  }
})

test("the apps and the page previews on offer are the apps and pages the monorepo has", () => {
  assert.deepEqual(APPS_WITH_LABELS.map((app) => app.id).toSorted(), [...APP_IDS].toSorted())
  // The home apps that have code have previews too; the rest have none until their phase.
  const withCode = appsInGroup("home").filter((app) => ["penger", "hjem", "miniflux", "innboks"].includes(app.id))
  const pages = [...listApps(), ...withCode].flatMap((app) => ["/", ...app.pages.map((page) => page.to).filter((to) => to !== "/")].map((to) => `${app.id}:${to}`))
  assert.deepEqual([...PAGE_IDS].toSorted(), pages.toSorted())
})
