import { createAstroConfig } from '@designsystem/config/astro-preset'

// One Node server mounts this build under sky.lmfaole.party/apps/medier/boker/ (`scripts/media-server.ts`); its pages read the local database through an in-process fetcher.
export default createAstroConfig(import.meta.dirname, { runtime: 'node', base: '/apps/medier/boker/' })
