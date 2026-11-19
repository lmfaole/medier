import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"

/** The code of a component, not the comments that explain it. */
const code = (file: string) => readFileSync(join(import.meta.dirname, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

test("an avatar is made of a span and an img, never a block: it may sit in a text, which is a <p>, and a <div> there breaks the line apart", () => {
  const avatar = code("avatar.tsx")
  assert.ok(!/<div\b/.test(avatar), "avatar.tsx writes a block")
  assert.ok(/<img\b/.test(avatar) && avatar.includes('aria-hidden="true"') && avatar.includes("appUrl("))
  assert.ok(avatar.includes("rounded-full"))
})

test("the list of artists is a list, one under the other, with the picture, the name and the count of each", () => {
  const list = code("avatar-list.tsx")
  assert.ok(list.includes("<ul") && list.includes("<li"))
  assert.ok(!/<div\b/.test(list))
  assert.ok(list.includes("<Avatar"))
  assert.ok(list.includes("aria-label={label}"))
})

test("a period's card says its title, then its plays with the change as an icon for up or down, then the list; the words of the change are for a screen reader", () => {
  const card = code("period-card.tsx")
  for (const icon of ["TrendingUp", "TrendingDown", "Minus"]) assert.ok(card.includes(icon), icon)
  assert.ok(card.includes('className="sr-only"'))
  assert.ok(card.includes("{children}"))
  assert.ok(card.includes("<CardTitle"))
})

test("what the avatars of a line of text were is gone: the lists are the way artists are shown", () => {
  for (const file of ["avatar-name.tsx", "avatar-line.tsx"]) assert.throws(() => readFileSync(join(import.meta.dirname, file)), file)
})
