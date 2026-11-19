import { strict as assert } from "node:assert"
import { test } from "node:test"

import { assetIdOf, fileNameOf } from "./asset-id.ts"

const HASH = "a".repeat(40)

test("the file name and the asset id are each other's inverse, and only that shape is accepted", () => {
  const id = `image-${HASH}-1200x630-png`
  assert.equal(fileNameOf(id), `${HASH}-1200x630.png`)
  assert.equal(assetIdOf(`${HASH}-1200x630.png`), id)
  for (const name of ["", "x.png", `${HASH}-1200x630`, `../${HASH}-1x1.png`, `${HASH}-1x1.png/extra`]) assert.equal(assetIdOf(name), null, name)
})

test("an id of another shape has no file name", () => {
  for (const id of ["", "file-abc-pdf", `image-${HASH}-640x480`, "image-zz-1x1-jpg", `image-${HASH}-640x480-jpg/../x`]) assert.equal(fileNameOf(id), null, id)
})
