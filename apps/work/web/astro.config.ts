import { createAstroConfig } from '@designsystem/config/astro-preset'

// The page and the Worker in one build (Astro on Cloudflare Workers), mounted at `lmfaole.party/cv`.
export default createAstroConfig(import.meta.dirname, { base: '/cv', wranglerConfigPath: '../wrangler.jsonc', edgeCachedPages: ['/'] })
