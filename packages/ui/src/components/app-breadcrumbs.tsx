import { Breadcrumbs } from "@lmfaole/designsystem/components/breadcrumbs"

import type { AnyAppId } from "../lib/apps"
import { breadcrumbTrail } from "../lib/breadcrumbs"

/**
 * Where the page is, at the top of every page of an app: the group (Medier, for a media app), the app, the page a subpage is under and the
 * page itself, with the parent alone as a way back on a phone. The page of one thing is named by `title`. Plain links, rendered on the
 * server with no script.
 */
export function AppBreadcrumbs({ app, path, title }: { app: AnyAppId; path: string; title?: string }) {
  return <Breadcrumbs items={breadcrumbTrail(app, path, undefined, title).map(({ label, href }) => ({ label, href }))} />
}
