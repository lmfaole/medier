/**
 * Astro config for an app, on one of two runtimes (`AstroAppOptions.runtime`).
 *
 * `cloudflare` (`forside`, `work`): the Cloudflare adapter runs the Worker in workerd against the app's `wrangler.jsonc`.
 * Pages render on the server per request with their data read from the snapshot in the asset store; there is no database
 * or session store, and the pages an app names are kept at the edge for minutes (`PAGE_EDGE_CACHE`).
 *
 * `node` (the eight media apps, and the home apps, `pwa: 'app'`): `@astrojs/node` in middleware mode, so `scripts/media-server.ts` mounts every app under its
 * `base` in one http server. Pages read their data through an in-process `Fetcher` over the local databases
 * (`scripts/media-data.ts`); `cloudflare:workers` is a virtual module that hands the page that fetcher.
 *
 * Either way React islands hydrate the interactive parts, Tailwind comes from its Vite plugin and links are prefetched on hover.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cloudflare from '@astrojs/cloudflare'
import { cacheCloudflare } from '@astrojs/cloudflare/cache'
import node from '@astrojs/node'
import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'
import type { AstroIntegration } from 'astro'
import { defineConfig } from 'astro/config'
import type { PluginOption } from 'vite'

import { inspectorPortFrom } from './inspector-port.ts'
import { buildServiceWorker } from './pwa/build-sw.ts'

interface CommonOptions {
  /** Where the app is mounted (`/apps/musikk`); left out for an app at the domain root. */
  base?: string
}

export interface CloudflareAppOptions extends CommonOptions {
  runtime?: 'cloudflare'
  /** The app's `wrangler.jsonc`, relative to `appRoot`, e.g. `'../wrangler.jsonc'`. */
  wranglerConfigPath: string
  /** The pages whose HTML Cloudflare may keep at the edge (`'/medier'`, `'/archive/[...path]'`), under the rule `PAGE_EDGE_CACHE`. */
  edgeCachedPages?: readonly string[]
}

export interface NodeAppOptions extends CommonOptions {
  runtime: 'node'
  /** A Node app is always mounted: `scripts/media-server.ts` routes by this path. */
  base: string
  /**
   * `'hub'` for the one app a browser installs (`apps/medier`): its build holds the manifest and the service worker every media app links.
   * `'app'` for a home app (innboks, hjem, penger, miniflux) that is installed on its own, at the address its installed copies already have
   * (`/apps/hjemmeserver/<id>/`): its build holds its own manifest (`id`, `start_url` and `scope` are its base) and a network-first shell worker at `<base>/sw.js`.
   */
  pwa?: 'hub' | 'app'
}

export type AstroAppOptions = CloudflareAppOptions | NodeAppOptions

/**
 * The media apps are one installed app (a home app is one of its own, `pwa: 'app'`). Every Node build says so to `Document.astro` (`PUBLIC_PWA`), which links the hub's
 * manifest and registers its worker; the hub's own build holds the two: `/manifest.webmanifest` as an injected route and
 * `public/sw.js`, compiled before the build or dev server reads `public/`.
 */
function pwaIntegration(pwa: 'hub' | 'app' | undefined): AstroIntegration {
  const { define, route } = pwaSetup(pwa)
  return {
    name: 'pwa',
    hooks: {
      'astro:config:setup': async ({ config, injectRoute, updateConfig }) => {
        updateConfig({ vite: { define } })
        if (route === undefined) return
        injectRoute(route)
        await buildServiceWorker(path.join(fileURLToPath(config.publicDir), 'sw.js'), undefined, pwa)
      },
    },
  }
}

/**
 * What a build's `pwa` option means: the define that tells `Document.astro` how the build installs (`true`: part of the hub's installed app;
 * `"app"`: on its own, with its own manifest at its own base), and the manifest route a hub or an app build injects.
 */
export function pwaSetup(pwa: 'hub' | 'app' | undefined): { define: Record<string, string>; route?: { pattern: string; entrypoint: string } } {
  const define = { 'import.meta.env.PUBLIC_PWA': pwa === 'app' ? '"app"' : 'true' }
  if (pwa === undefined) return { define }
  return { define, route: { pattern: '/manifest.webmanifest', entrypoint: pwa === 'app' ? '@designsystem/ui/pwa-app-manifest-route' : '@designsystem/ui/pwa-manifest-route' } }
}

/**
 * How long Cloudflare keeps a page at the edge, as `Cloudflare-CDN-Cache-Control`, which only the edge reads: the browser's
 * `Cache-Control` is still `cacheControlFor`. A snapshot changes on a deploy, a few times a day at most. A page that answers
 * an error calls `Astro.cache.set(false)`, so the edge never keeps a 404.
 * There is no rule for `/api/*`: the files are static assets and the cache of the asset store serves them; what reaches the
 * route is a miss, a 404 that must not be kept.
 */
export const PAGE_EDGE_CACHE = { maxAge: 300, swr: 3600 } as const

/**
 * `cloudflare:workers` for a build that does not run in workerd: the one thing the pages and the API endpoint take from it is
 * `env.ASSETS`, which here is the app's in-process fetcher (`api-fetchers.ts`), registered by the server before it loads the build.
 */
function nodeBindings(base: string): PluginOption {
  const virtualId = '\0virtual:cloudflare-workers-for-node'
  const fetchers = path.join(import.meta.dirname, 'api-fetchers.ts')
  return {
    name: 'cloudflare-workers-for-node',
    enforce: 'pre',
    resolveId: (source) => (source === 'cloudflare:workers' ? virtualId : undefined),
    load: (id) =>
      id === virtualId
        ? `import { apiFetcherFor } from ${JSON.stringify(fetchers)}\nexport const env = { get ASSETS() { return apiFetcherFor(${JSON.stringify(base)}) } }\n`
        : undefined,
  }
}

/** `appRoot` is `import.meta.dirname` of the calling app's `astro.config.ts`. */
export function createAstroConfig(appRoot: string, options: AstroAppOptions): ReturnType<typeof defineConfig> {
  const { base } = options
  const runtime = options.runtime ?? 'cloudflare'
  const inspectorPort = inspectorPortFrom()
  return defineConfig({
    root: appRoot,
    output: 'server',
    ...(base === undefined ? {} : { base }),
    // Client JavaScript under `/_astro/` is hashed, which the immutable cache rule relies on. A prerendered page is
    // `kilder.html`, not `kilder/index.html`, because the asset store answers the latter with a redirect to `/kilder/`.
    build: { assets: '_astro', format: 'file' },
    // No sessions and no image service: the adapter would add a KV namespace and an Images binding,
    // and a Worker here binds neither (`forbiddenBindings`).
    session: false,
    // Every same-origin link is fetched on hover or focus, and a tap on touch.
    prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
    ...(options.runtime === 'node'
      ? { adapter: node({ mode: 'middleware' }) }
      : {
          adapter: cloudflare({
            imageService: 'passthrough',
            configPath: options.wranglerConfigPath,
            ...(inspectorPort === undefined ? {} : { inspectorPort }),
            // A VPC service binding has no local simulation, and no app develops against a remote binding.
            remoteBindings: false,
            persistState: { path: path.join(path.dirname(path.resolve(appRoot, options.wranglerConfigPath)), '.wrangler/state') },
          }),
          // Headers only: the provider tags and times the edge's copy, and nothing it does at render time needs a binding
          // (`invalidate` would, and nothing calls it). Without a rule the adapter answers `Cloudflare-CDN-Cache-Control: no-store`.
          cache: { provider: cacheCloudflare() },
          routeRules: Object.fromEntries((options.edgeCachedPages ?? []).map((page) => [page, PAGE_EDGE_CACHE])),
        }),
    integrations: [react(), ...(options.runtime === 'node' ? [pwaIntegration(options.pwa)] : [])],
    vite: {
      plugins: [tailwindcss(), ...(runtime === 'node' ? [nodeBindings((base ?? '/').replace(/\/$/, ''))] : [])],
      resolve: { alias: { '@': path.join(appRoot, 'src') } },
      // The design system is a git dependency shipped as TypeScript source: left external, Node would be asked to run `.tsx` from `node_modules`.
      ssr: { noExternal: ['@lmfaole/designsystem'] },
      // A font small enough to be inlined as a `data:` URL would be blocked by `font-src 'self'`.
      build: { assetsInlineLimit: 0 },
    },
  })
}
