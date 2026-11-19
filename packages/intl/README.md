# @designsystem/intl

Shared date, number and plural formatting for `cv`, `budget` and `music`,
built only on the platform's own `Intl` objects — no formatting library, per
the root `AGENTS.md` rule against adding dependencies.

## What is here

- `date.ts` — `formatDate` (`Intl.DateTimeFormat`) and `formatRelativeDate`
  (`Intl.RelativeTimeFormat`, auto-picks the coarsest sensible unit).
- `number.ts` — `formatNumber` and `formatCurrency` (`Intl.NumberFormat`).
- `plural.ts` — `pluralize` (`Intl.PluralRules`), for picking the right word
  form for a count instead of a hand-written `count === 1 ? ... : ...` that
  only happens to work for English.

Every function takes the locale explicitly — nothing here assumes a single
language, since `music` is English and `cv`/`budget` are Norwegian.
`Intl` object construction is cached internally per locale/options pair, so
callers do not need to worry about re-creating formatters in a loop.

## Usage from an app

```ts
import { formatDate, formatRelativeDate } from "@designsystem/intl/date"
import { formatCurrency, formatNumber } from "@designsystem/intl/number"
import { pluralize } from "@designsystem/intl/plural"

formatDate("1997-01-01", "nb-NO", { day: "numeric", month: "long", year: "numeric" })
// "1. januar 1997"

formatCurrency(1234, "nb-NO", "NOK", { maximumFractionDigits: 0 })
// "kr 1 234"

pluralize(3, { one: "{count} dag", other: "{count} dager" }, "nb-NO")
// "3 dager"
```

An app's own `lib/format.ts` still owns its domain-specific wrappers (what
locale, what currency, what the "all time" label is) — this package only
owns the `Intl` plumbing underneath them.
