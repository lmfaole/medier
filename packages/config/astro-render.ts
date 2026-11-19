/**
 * Hands a request to Astro on Cloudflare: the adapter's setup (locals, `waitUntil`) first, then the page or endpoint it matches.
 * Only a built or running Worker can load this (it imports Astro's virtual modules), which is why `astro-worker.ts` takes it as an argument.
 */
import { cf, finalize } from '@astrojs/cloudflare/fetch'
import { astro, FetchState } from 'astro/fetch'

import type { AstroRender } from './astro-worker.ts'
import type { WorkerEnv } from './worker-app.ts'

export const renderWithAstro: AstroRender<WorkerEnv> = async (request, env, ctx, { api }) => {
  const state = new FetchState(request)
  // The adapter answers a file of `dist/client` by its path alone, so `/api/x.json?period=2024` would get `x.json`; the endpoint maps the query to its own file.
  if (api) return finalize(state, await astro(state))
  const early = ctx === undefined ? undefined : await cf(state, env, ctx)
  return early ?? finalize(state, await astro(state))
}
