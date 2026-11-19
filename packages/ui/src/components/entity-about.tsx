import type { ReactNode } from "react"

import { FactList, LinkList } from "@lmfaole/designsystem/components/fact-list"

/**
 * What a page says about its thing at more length, for the rail (`EntityAbout`'s `info`): paragraphs of
 * text, the facts as a list, links out. None where there is nothing to say, so the head has no button.
 */
export function aboutOf({ paragraphs = [], facts = [], links = [] }: { paragraphs?: readonly ReactNode[]; facts?: readonly (readonly [string, ReactNode])[]; links?: readonly (readonly [string, string | null])[] }): ReactNode {
  const told = paragraphs.filter((paragraph) => paragraph !== null && paragraph !== undefined && paragraph !== "")
  const known = facts.filter(([, value]) => value !== null && value !== undefined && value !== "")
  const reachable = links.filter(([, href]) => href !== null && href !== "")
  if (told.length === 0 && known.length === 0 && reachable.length === 0) return null
  return (
    <div className="grid gap-3">
      {told.map((paragraph, index) => (
        <p key={index} className="whitespace-pre-line text-muted-foreground">
          {paragraph}
        </p>
      ))}
      <FactList facts={known} />
      <LinkList links={reachable} />
    </div>
  )
}
