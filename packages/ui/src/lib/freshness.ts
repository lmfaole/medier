import * as v from "valibot"

import { formatTime } from "@designsystem/intl/time"
import { pluralize } from "@designsystem/intl/plural"

/** The file `npm run snapshot` writes for every app that has a sync: when it last ran well and how many rows it added. */
export const Freshness = v.object({
  finishedAt: v.string(),
  added: v.number(),
  /** What a row is called, in the singular and the plural: `visning`, `visninger`. */
  one: v.string(),
  many: v.string(),
})

export type Freshness = v.InferOutput<typeof Freshness>

export function freshnessSentence({ finishedAt, added, one, many }: Freshness): string {
  const when = formatTime(finishedAt)
  const news = added === 0 ? `ingen nye ${many}` : pluralize(added, { one: `{count} ny ${one}`, other: `{count} nye ${many}` }, "nb-NO")
  return `Sist oppdatert ${when}, ${news}.`
}
