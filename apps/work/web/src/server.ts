// The Worker's entry (`main` in ../wrangler.jsonc): Astro's renderer behind the shared indexable Worker. The headers
// and the crawler policy (AI and SEO bots refused, search engines in) are `createIndexableAstroWorker`'s. A request for the former host
// (`jobb.lmfaole.party`) is answered with a redirect to `lmfaole.party/cv` before anything else.
import { renderWithAstro } from '@designsystem/config/astro-render'
import { createIndexableAstroWorker } from '@designsystem/config/indexable-astro-worker'

import { formerHostRedirect } from '@/lib/former-host'

const worker = createIndexableAstroWorker(renderWithAstro)

export default {
  async fetch(request: Request, env: Parameters<typeof worker.fetch>[1], ctx: Parameters<typeof worker.fetch>[2]) {
    const moved = formerHostRedirect(new URL(request.url))
    if (moved !== null) return Response.redirect(moved, 301)
    return worker.fetch(request, env, ctx)
  },
} satisfies typeof worker
