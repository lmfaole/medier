import { strict as assert } from "node:assert"
import { test } from "node:test"

import { appColorHex, oklchToHex } from "./app-color.ts"

test("OKLCH converts to the sRGB hex of its CSS meaning", () => {
  assert.equal(oklchToHex(1, 0, 0), "#ffffff")
  assert.equal(oklchToHex(0, 0, 0), "#000000")
  assert.equal(oklchToHex(0.628, 0.2577, 29.23), "#ff0000")
})

test("the first --app colour of the stylesheet is the light theme's, and a missing one is an error", () => {
  const css = ":root { --app-film: oklch(1 0 0); }\n.dark { --app-film: oklch(0 0 0); }"
  assert.equal(appColorHex(css, "film"), "#ffffff")
  assert.throws(() => appColorHex(css, "tv"), /--app-tv/)
})
