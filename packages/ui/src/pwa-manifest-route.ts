/**
 * `<hub>/manifest.webmanifest`, injected by `astro-preset` into the hub (`pwa: 'hub'`). It is written at build time:
 * the manifest never depends on the request.
 */
import type { APIRoute } from "astro"

import { pwaManifest } from "./lib/pwa-manifest.ts"

export const prerender = true

export const GET: APIRoute = () => new Response(JSON.stringify(pwaManifest()), { headers: { "Content-Type": "application/manifest+json; charset=utf-8" } })
