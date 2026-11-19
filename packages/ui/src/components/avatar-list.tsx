// Astro: plain HTML, no directive.

import type { ReactNode } from "react"

import { Avatar } from "./avatar"

/**
 * Names one under the other, each with its avatar in front and its count at the end of the row («Beyoncé … 42»). [label] says what the list is
 * («Mest hørt») to a screen reader; a card around it says it to everyone else. The name is whatever the app makes of it (a link, usually).
 */
export function AvatarList({ label, items }: { label: string; items: readonly { key: string; image: string | null | undefined; name: ReactNode; count: string }[] }) {
  return (
    <ul aria-label={label} className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-x-8">
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-3">
          <Avatar image={item.image} />
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{item.name}</span>
          <span className="text-sm tabular-nums text-muted-foreground">{item.count}</span>
        </li>
      ))}
    </ul>
  )
}
