/**
 * `<base>/manifest.webmanifest` of a home app, injected by `astro-preset` (`pwa: 'app'`). Written at build time. Which app it is comes from the
 * build's own base (`/apps/hjemmeserver/penger`), so the one entry point serves all four.
 */
import type { APIRoute } from "astro"

import { HOME_APP_IDS, appMountPath } from "./lib/apps.ts"
import { appManifest } from "./lib/pwa-manifest.ts"

export const prerender = true

export const GET: APIRoute = () => {
  const base = (import.meta.env.BASE_URL ?? "/").replace(/\/+$/, "")
  const id = HOME_APP_IDS.find((candidate) => appMountPath(candidate) === base)
  if (id === undefined) return new Response(`no home app is mounted at ${base}`, { status: 404 })
  return new Response(JSON.stringify(appManifest(id)), { headers: { "Content-Type": "application/manifest+json; charset=utf-8" } })
}
