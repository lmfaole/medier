import { ANY_APPS, appMountPath, APPS, listApps, type HomeAppId } from "./apps.ts"
import { THEME_COLOR } from "./app-head.ts"
import { HUB, HUB_MOUNT } from "./hub.ts"

/** The icon files `scripts/pwa-icons.ts` writes into the hub's `web/public/pwa/`, in the order the manifest lists them. */
export const PWA_ICONS = [
  { file: "icon-192.png", sizes: "192x192", purpose: "any" },
  { file: "icon-512.png", sizes: "512x512", purpose: "any" },
  { file: "icon-maskable-512.png", sizes: "512x512", purpose: "maskable" },
] as const

interface ManifestIcon {
  src: string
  sizes: string
  type: "image/png"
  purpose?: "any" | "maskable"
}

/** A manifest's share target: the share sheet of the phone sends files to `action` as a multipart POST, which the app's worker takes (`innboks`). */
interface ShareTarget {
  action: string
  method: "POST"
  enctype: "multipart/form-data"
  params: { files: { name: string; accept: string[] }[] }
}

export interface WebAppManifest {
  id: string
  name: string
  short_name: string
  description: string
  lang: string
  start_url: string
  scope: string
  display: "standalone"
  background_color: string
  theme_color: string
  icons: ManifestIcon[]
  shortcuts?: { name: string; description: string; url: string; icons: ManifestIcon[] }[]
  share_target?: ShareTarget
}

/**
 * The page's surface in the light theme, what the manifest of the Nextcloud app painted a bar with before the page said more: `background_color`
 * and `theme_color` of every home app, so an installed copy looks the same after the move.
 */
export const HOME_SURFACE = "#ffffff"

/**
 * The one web app manifest: the hub installs, and every media app is inside its `scope`, so a link from one app to
 * another stays in the installed window. Each app is a shortcut on the icon. Everything is an absolute path built from
 * the registry, so a rename or a move is made once.
 */
export function pwaManifest(): WebAppManifest & { shortcuts: NonNullable<WebAppManifest["shortcuts"]> } {
  return {
    id: `${HUB_MOUNT}/`,
    name: HUB.label,
    short_name: HUB.label,
    description: HUB.description,
    lang: "nb",
    start_url: `${HUB_MOUNT}/`,
    scope: `${HUB_MOUNT}/`,
    display: "standalone",
    background_color: THEME_COLOR.light,
    theme_color: THEME_COLOR.light,
    icons: PWA_ICONS.map((icon) => ({ src: `${HUB_MOUNT}/pwa/${icon.file}`, sizes: icon.sizes, type: "image/png", purpose: icon.purpose })),
    shortcuts: listApps().map((app) => ({
      name: app.label,
      description: APPS[app.id].description,
      url: new URL(app.href).pathname,
      icons: [{ src: `${HUB_MOUNT}/pwa/app-${app.id}-192.png`, sizes: "192x192", type: "image/png" }],
    })),
  }
}

/**
 * The manifest of one home app, which installs on its own. `start_url` and `scope` are the app's address with a trailing slash, exactly what the
 * manifest of the Nextcloud app (`PageController::manifest`) had, and `id` is the same value (the browser took it from `start_url` before, so an
 * installed copy keeps its identity and its scope). The icons are the app's own, `<base>/pwa/` of its `web/public`. `innboks` is a share target.
 */
export function appManifest(id: HomeAppId): WebAppManifest {
  const mount = appMountPath(id)
  const start = `${mount}/`
  const { label, description } = ANY_APPS[id]
  return {
    id: start,
    name: label,
    short_name: label,
    description,
    lang: "nb",
    start_url: start,
    scope: start,
    display: "standalone",
    background_color: HOME_SURFACE,
    theme_color: HOME_SURFACE,
    icons: PWA_ICONS.map((icon) => ({ src: `${mount}/pwa/${icon.file}`, sizes: icon.sizes, type: "image/png", purpose: icon.purpose })),
    ...(id === "innboks"
      ? { share_target: { action: `${start}share`, method: "POST", enctype: "multipart/form-data", params: { files: [{ name: "files", accept: ["*/*"] }] } } satisfies ShareTarget }
      : {}),
  }
}
