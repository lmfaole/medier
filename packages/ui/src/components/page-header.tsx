import type { ReactNode } from "react"

import { PageHeader as Header } from "@lmfaole/designsystem/components/page-header"

import { appSubPages, isAnyApp } from "../lib/apps"
import { pageHeader } from "../lib/og-pages"
import { AppSubPages } from "./app-sub-pages"

/**
 * A page's header (the design system's `PageHeader`) with its texts looked up: with `page` (`<app>:<path>`) they are the
 * page's row in `og-pages.json`, with `values` filling its `{count}`-style placeholders; a `title` or `lead` given here
 * wins, for a header built from data.
 */
export function PageHeader({ page, subpages = page, values, title, lead, actions }: { page?: string; /** The page (`<app>:<path>`) whose subpages are listed under the title: the page itself unless a page with its own title says which it is; `false` where the page lists them itself, lower (after what stops something, which comes first). */ subpages?: string | false | undefined; values?: Readonly<Record<string, string | number>>; title?: string; lead?: string | undefined; actions?: ReactNode }) {
  const fromPage = page === undefined ? {} : pageHeader(page, values)
  const listed = subpages === false ? undefined : subpages
  const colon = listed?.indexOf(":") ?? -1
  const app = listed === undefined || colon < 0 ? undefined : listed.slice(0, colon)
  const to = listed === undefined || colon < 0 ? "/" : listed.slice(colon + 1)
  return (
    <>
      <Header title={title ?? fromPage.title ?? ""} lead={lead ?? fromPage.lead} actions={actions} />
      {app !== undefined && isAnyApp(app) && appSubPages(app, to).length > 0 ? <AppSubPages app={app} to={to} /> : null}
    </>
  )
}
