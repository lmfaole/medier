/**
 * Compiles `sw.ts` to one classic script, `web/public/sw.js` of an app. esbuild comes with Vite, so nothing is added;
 * the file is a build product (gitignored) and is rewritten on every `astro dev` and `astro build`.
 */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { build } from 'esbuild'

/** The hub's worker (every media app is under it) and a home app's own shell worker. */
const ENTRIES = { hub: new URL('./sw.ts', import.meta.url).pathname, app: new URL('./sw-app.ts', import.meta.url).pathname } as const

/** Writes the worker to `outfile`; `buildId` names its cache and is a new value each build. */
export async function buildServiceWorker(outfile: string, buildId: string = Date.now().toString(36), kind: keyof typeof ENTRIES = 'hub'): Promise<void> {
  mkdirSync(dirname(outfile), { recursive: true })
  await build({
    entryPoints: [ENTRIES[kind]],
    outfile,
    bundle: true,
    minify: true,
    format: 'iife',
    target: 'es2023',
    define: { BUILD_ID: JSON.stringify(buildId) },
    logLevel: 'warning',
  })
}
