import { createAstroConfig } from '@designsystem/config/astro-preset'

// The page and the Worker in one build (Astro on Cloudflare Workers), at the root of the domain.
export default createAstroConfig(import.meta.dirname, { wranglerConfigPath: '../wrangler.jsonc', edgeCachedPages: ['/', '/medier', '/kilder'] })
