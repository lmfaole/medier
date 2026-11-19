// The Worker's entry (`main` in ../wrangler.jsonc): the paths that moved away, then Astro's
// handler behind the shared indexable Worker.
import { renderWithAstro } from '@designsystem/config/astro-render'
import { createIndexableAstroWorker } from '@designsystem/config/indexable-astro-worker'
import type { WorkerEnv } from '@designsystem/config/worker-app'

import { movedTo } from './lib/moved-paths.ts'

const worker = createIndexableAstroWorker(renderWithAstro)

export default {
  fetch(request: Request, env: WorkerEnv, ctx?: ExecutionContext): Response | Promise<Response> {
    const url = new URL(request.url)
    const moved = movedTo(url.pathname)
    if (moved !== null) return Response.redirect(new URL(`${moved}${url.search}`, url.origin).href, 301)
    return worker.fetch(request, env, ctx)
  },
}
