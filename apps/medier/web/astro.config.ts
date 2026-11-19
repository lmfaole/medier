import { createAstroConfig } from '@designsystem/config/astro-preset'

// The hub of the media apps, mounted at sky.lmfaole.party/apps/medier with every app under it (`scripts/media-server.ts`). Its build holds the one manifest and service worker.
export default createAstroConfig(import.meta.dirname, { runtime: 'node', pwa: 'hub', base: '/apps/medier' })
