import type { ReactNode } from "react"

import { PageLayout } from "@lmfaole/designsystem/components/page-layout"

import type { AnyAppId } from "../lib/apps"

interface AppLayoutProps {
  /** Which app this is; kept so the layout and what stands in it (`AppNav`, `AppBreadcrumbs`) are told the same. */
  app: AnyAppId
  /** The app's navigation (`AppNav`): a bar at the foot on a phone, a rail at the left from tablet width. `AppPage` puts it here. */
  nav?: ReactNode
  /** What follows the page inside the column; `AppPage` puts the server island with the sentence about the data here. */
  after?: ReactNode
  children: ReactNode
}

/**
 * The page frame shared by every app: the design system's `PageLayout` (skip link, `<main>`, the reading column) with the app's
 * navigation (`AppNav`); `layouts/AppPage.astro` puts them together with the breadcrumbs, with no script.
 */
export function AppLayout({ nav, after, children }: AppLayoutProps) {
  return (
    <PageLayout nav={nav} after={after}>
      {children}
    </PageLayout>
  )
}
