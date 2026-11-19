# @designsystem/config

Shared TypeScript, oxlint and Astro configuration, and the Worker request
pipeline, for the web apps in this monorepo. Every app
uses this package instead of each app carrying its own copy of the same
baseline setup.

## What is here

- `tsconfig.app.json` — browser app defaults for Astro + React (`DOM`,
  `vite/client`, `jsx: react-jsx`, `moduleResolution: bundler`, `noEmit`).
  `strict` and `noImplicitReturns` are on here and in the other two, so an app
  that extends one is typechecked strictly without saying so.
- `tsconfig.node.json` — Node-side defaults for files such as `astro.config.ts`
  (`types: ["node"]`, `module: "nodenext"`, `noEmit`).
- `tsconfig.worker.json` — Cloudflare Workers backend defaults for an app's
  `src/worker.ts` and friends (`lib: ["ES2023", "WebWorker"]`,
  `module: "nodenext"`, `noEmit`). Consumed by relative path
  (`../../packages/config/tsconfig.worker.json`), not the package name,
  since an app's Worker-side root (`apps/<app>`, as opposed to
  `apps/<app>/web`) is not an npm workspace.
- `cloudflare-workers.d.ts` — hand-written ambient `D1Database` /
  `D1PreparedStatement` / `Fetcher` types for the same Worker backends,
  typed against actual call sites rather than reproducing
  `@cloudflare/workers-types` (not a dependency here — see "Do not add
  dependencies"). Pull it in via each app's `tsconfig.json` `include`, by
  relative path, the same way.
- `oxlintrc.json` — shared oxlint rules. `plugins` replaces oxlint's default
  list rather than extending it, so the names listed (`react`, `typescript`,
  `oxc`, `unicorn`) are the whole set; dropping one silently switches off every
  rule that plugin owns. `correctness` and `suspicious` are on, and the typing
  rules (`no-explicit-any`, `no-non-null-assertion`, `ban-ts-comment`) close the
  escapes `strict` leaves open. Each of its `overrides` says why it exists.
- `astro-preset.ts` — `createAstroConfig(appRoot, { wranglerConfigPath,
  edgeCachedPages })` is an app's whole `astro.config.ts`: server output on the
  Cloudflare adapter against the app's `wrangler.jsonc`, React, Tailwind, `prefetch`,
  `build.format: 'file'` and the edge cache for the listed pages.
- `bindings-config.ts` — `forbiddenBindings(configText)`: the database, bucket,
  key-value or VPC bindings a `wrangler.jsonc` or built `wrangler.json` has at
  its top level. Every app is public, so a deploy that carries one is refused.
- `worker-app.ts` — `createWorkerApp({ prefixRoutes, fallback })`,
  the request pipeline every Worker shares: crawler block,
  uptime path, then the app's prefix routes, then `fallback`
  (`context.assets()` is the asset store with security headers and
  `cacheControlFor(pathname)`). Apps reach it through `createAstroWorker`.
- `astro-worker.ts` — `createAstroWorker({ render, prefixRoutes })`, the Worker for an
  Astro app: `createWorkerApp`'s pipeline first, then a file the asset store has, then
  Astro, whose inline island scripts are allowed by hash (`inline-script-hashes.ts`).
  `indexable-astro-worker.ts` is the same without the not-indexed layers (`work`, `forside`).
  `mounted-worker.ts` is the options type they share and the redirect of a moved page.
- `astro-api.ts` — `readApi(url, file, schema, params)` and `readPage`: how a page reads
  an API file of the snapshot while it renders, parsed by a valibot schema.
- `edge-cache.ts` — `withEdgeCache` and `cacheKey` on Workers' own cache.
- `api-files.ts`, `app-shell/lib/api.ts` — an app's whole JSON API from its one endpoint,
  `pages/api/[...file].ts`: `/api/<name>.json` is a file of the snapshot in the asset
  store, and anything else is a 404 JSON. `appApiHandler` is the `GET`.
- `cloudflare-env.ts` — `cloudflareEnv<Env>()`, the Worker's bindings for code
  that gets no `env` argument. The one place the untyped
  `cloudflare:workers` export is given a shape. Never imported by a test: that
  module resolves only inside a Worker.
- Astro loads the presets through `astro.config.ts` as it loads any TypeScript.
- An app's `tsc` typechecks these sources through its imports, as it does
  `packages/ui`'s, so they must compile under both this package's
  `tsconfig.json` and the apps' `tsconfig.app.json`.
- `scripts/*.ts` and `node --test` load them with Node's type stripping.
  Node refuses that under `node_modules`, but a workspace resolves to its
  real path, which has none. Relative imports spell out `.ts` for the same
  reason.
- `worker-test-kit.ts` holds the test doubles (the asset store, the
  edge cache, `fetchPath`) that this package's tests and every app's wiring
  test share. Test code only.

## Notes

- Pass `import.meta.dirname` as `appRoot`. The preset uses it to resolve `@`
  to that app's own `src/`.
- The apps currently point oxlint at `packages/config/oxlintrc.json` by file
  path from the `lint` script. They do not keep a per-app `.oxlintrc.json`.
