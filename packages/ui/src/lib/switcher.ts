import type { IconName } from "@lmfaole/designsystem/lib/icons"

import { appMountPath, appOrigin, HOME_APP_IDS, HOME_APPS, type HomeAppId } from "./apps.ts"
import { HUB, HUB_URL } from "./hub.ts"

/** One link of the list of the apps of the home server (`AppSwitcher`). */
export interface SwitcherLink {
  label: string
  description: string
  href: string
  icon: IconName
  current: boolean
}

/** What each app is, as a meaning of the design system's icons. */
const ICON_OF: Record<HomeAppId, IconName> = { innboks: "inbox", hjem: "home", miniflux: "link", penger: "tag" }

/**
 * Where a home app leads besides its own pages: the other home apps and the media hub, plain links (each is a build of its own, so a full
 * page load). The app the visitor is in is `current`. The same list on the front page of every home app.
 */
export function switcherLinks(current: HomeAppId): SwitcherLink[] {
  return [
    ...HOME_APP_IDS.map((id): SwitcherLink => ({ label: HOME_APPS[id].label, description: HOME_APPS[id].description, href: import.meta.env?.DEV ? appOrigin({ id, ...HOME_APPS[id] }) : `${appMountPath(id)}/`, icon: ICON_OF[id], current: id === current })),
    { label: HUB.label, description: HUB.description, href: HUB_URL, icon: "bookmark", current: false },
  ]
}
