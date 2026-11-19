# AGENTS.md — medier

`sky.lmfaole.party/apps/medier`: the hub of the media apps. The shared rules are in the root `AGENTS.md`.

- One page (`web/src/pages/index.astro`): every app of the registry (`AppList`) and the latest of the seven that keep a log
  (`MediaTimeline`), read live from their databases by the loader of `packages/timeline`, the same one `forside`'s `/medier` snapshots.
- It is **the one installed app**: its build holds `/manifest.webmanifest` and `/sw.js` (`pwa: 'hub'` in `astro.config.ts`), and the
  seven media apps are mounted under it (`/apps/medier/film`), so they are inside its scope. `packages/ui/src/lib/hub.ts` says where it is.
- It is not in the registry (`packages/ui/src/lib/apps.ts`): it has no pages to list and no breadcrumbs; the breadcrumbs of every app start here, as «Medier».
- Icons: `node scripts/pwa-icons.ts` writes `web/public/pwa/`.
