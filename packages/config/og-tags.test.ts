import { strict as assert } from "node:assert"
import { test } from "node:test"

import { ogMetaTags } from "./og-tags.ts"

const options = { title: "T", description: "D", url: "https://cv.lmfaole.party" }

test("ogMetaTags resolves the shared image against the app's url", () => {
  assert.ok(ogMetaTags(options).some((tag) => "property" in tag && tag.property === "og:image" && tag.content === "https://cv.lmfaole.party/og-image.jpg"))
})
