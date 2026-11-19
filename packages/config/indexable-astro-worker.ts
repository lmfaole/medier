/**
 * The Worker of a public Astro page that wants to be found: no `X-Robots-Tag`, and the crawlers it
 * refuses are the AI and SEO ones, never a search engine. The rest is `createAstroWorker`'s.
 */
import { createAstroWorker, type AstroRender } from './astro-worker.ts'
import { IS_DEV } from './dev-flag.ts'
import { AI_AND_SEO_CRAWLERS, DEV_SECURITY_HEADERS, INDEXABLE_HEADERS } from './security-headers.ts'
import type { WorkerEnv } from './worker-app.ts'

export function createIndexableAstroWorker(render: AstroRender<WorkerEnv>) {
  return createAstroWorker<WorkerEnv>({
    render,
    headers: IS_DEV ? DEV_SECURITY_HEADERS : INDEXABLE_HEADERS,
    blockedCrawlers: AI_AND_SEO_CRAWLERS,
  })
}
