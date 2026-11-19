import { Briefcase, Code, Film, ListTree, Users, Mail, RefreshCw, UserRound, type LucideIcon } from "lucide-react"

import { AppMark } from "./app-mark"
import type { AnyAppId } from "../lib/apps"

const ICONS = {
  github: Code,
  linkedin: Users,
  mail: Mail,
  media: Film,
  sources: ListTree,
  work: Briefcase,
  accounts: UserRound,
  sync: RefreshCw,
} as const satisfies Record<string, LucideIcon>

export type LinkRailIcon = keyof typeof ICONS

/** One link of the rail: where it goes, what it is called and what is there; `mark` is an app's own mark, `icon` one of a closed set. */
export type LinkRailItem = {
  href: string
  label: string
  description: string
  /** A link to another site, opened as such. */
  external?: boolean
} & ({ icon: LinkRailIcon; mark?: never } | { mark: AnyAppId; icon?: never })

/**
 * Links as a menu in a rail beside a page's content (the look of `PageRail` and the hub's app list): the icon or app mark, the name and what it
 * is under it, each a link. Used where the links are not an app's own pages: the front page's way to the other pages and sites, and a page's own anchors.
 */
export function LinkRail({ links, label }: { links: readonly LinkRailItem[]; label: string }) {
  if (links.length === 0) return null
  return (
    <nav aria-label={label} className="grid gap-3">
      {links.map((link) => {
        const Icon = link.icon === undefined ? null : ICONS[link.icon]
        return (
          <a
            key={link.href}
            href={link.href}
            {...(link.external ? { rel: "noopener noreferrer" } : {})}
            className="flex items-center gap-4 rounded-xl border p-3 no-underline outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {link.mark !== undefined ? (
              <AppMark app={link.mark} />
            ) : Icon !== null ? (
              <span aria-hidden="true" className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Icon className="size-4" />
              </span>
            ) : null}
            <span className="grid min-w-0 gap-0.5">
              <span className="font-heading text-lg font-medium">{link.label}</span>
              <span className="text-sm text-muted-foreground">{link.description}</span>
            </span>
          </a>
        )
      })}
    </nav>
  )
}
