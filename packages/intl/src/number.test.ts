import { strict as assert } from "node:assert"
import { test } from "node:test"

import { formatAmount, formatCurrency, formatNumber } from "./number.ts"

// nb-NO separates thousands with a no-break space (U+00A0) and uses U+2212 for minus.
const space = " "

test("formatNumber groups thousands per locale", () => {
  assert.equal(formatNumber(1234567, "en-US"), "1,234,567")
  assert.equal(formatNumber(1234567, "nb-NO"), `1${space}234${space}567`)
})

test("formatCurrency formats kroner the Norwegian way, and options override the defaults", () => {
  assert.equal(formatCurrency(1500, "nb-NO", "NOK", { maximumFractionDigits: 0 }), `1${space}500${space}kr`)
  assert.equal(formatCurrency(-1500, "nb-NO", "NOK", { maximumFractionDigits: 0 }), `−1${space}500${space}kr`)
  assert.equal(formatCurrency(1500, "en-US", "USD"), "$1,500.00")
})

test("an amount is the number and its currency, «kr» for NOK, and nothing after a number whose currency is not known", () => {
  assert.equal(formatAmount(199, "NOK"), `199${space}kr`)
  assert.equal(formatAmount(1299.5, "NOK"), `1${space}299,5${space}kr`)
  assert.equal(formatAmount(9.99, "USD"), `9,99${space}USD`)
  assert.equal(formatAmount(12.345, "NOK"), `12,35${space}kr`)
  assert.equal(formatAmount(50), "50")
})
