# AGENTS.md

What is specific to `forside`. The rules every app shares are in `../../AGENTS.md`. For humans: `README.md`.

## What this project is

The pages of `lmfaole.party`: `/` with the name and role, the bio in the main column and a rail (`LinkRail`) with Medier, Kilder, Jobb, GitHub, LinkedIn and e-post, and `/medier`, which is a row of links to the media apps of the registry (`group: "media"`) and under it «Logg»: the newest 50 of all seven services (music, podkast, film, tv, games, books, boardgames) as one timeline, a day at a time, with a link to `/kilder` at its top right. A zone route
(`lmfaole.party/*`), not a custom domain, because the old addresses of the media apps (`/medier/<app>`, `/rss`) are paths of this host. It has no database binding, but a snapshot: `server/api.ts` builds `timeline.json` from the local databases (what those apps already show of their latest), and a publish timer (`scripts/publish-timers.ts forside`) deploys it every three hours when it changed, **unless the latest run of a job that feeds the log did not finish well** (of music, film and tv only the jobs that write plays and watches count, `publish-schedule.ts`; then the log stays as it was, so a failing sync shows as an old log). `/medier` and `/kilder` are linked from the rail of `/`, and are in `sitemap.xml`. `/kilder` (a rail of anchors beside one column of tables, one section per app) lists only the sources of the content, per app, with how often each is fetched and, worked out in the browser, when the next fetch is. A path a media app left behind when it moved to `sky.lmfaole.party/apps/<app>` (`/media`,
`/musikk`, `/podkast`, `/film`, `/medier/<app>`, `/rss`) is not a 404: the Worker redirects it (301) (`web/src/lib/moved-paths.ts`).

## Where things are

| Path | Owns |
| --- | --- |
| `web/src/lib/profile.ts` | The name, the bio, the links, and each page's own head content (`PAGES`), once |
| `web/src/pages/index.astro` | `/`: the name, the bio and the links, in Astro with the head, Open Graph and JSON-LD of `pageOg` |
| `web/src/lib/sources.ts`, `web/src/lib/next-sync.ts`, `web/src/components/NextSync.tsx`, `web/src/views/Kilder.tsx`, `web/src/pages/kilder.astro` | `/kilder`: each app's sources (API, export or register), how often each is fetched and the timer's times (from `apps/<app>/sync-rust/schedule.json`, kept in step by hand), and the next fetch worked out with the reader's clock after hydration. When an app gets a new source, a line goes in `sources.ts` |
| `web/src/views/Media.tsx`, `web/src/pages/medier.astro` | `/medier`: a link per app of the registry's `media` group, and the log; the page reads `timeline.json` as it renders (`readApi`) and the view only draws it |
| `web/src/pages/404.astro`, `web/src/pages/api/[...file].ts` | The shared 404 page, and the one `GET` that serves `/api/<file>.json` from the snapshot |
| `@designsystem/timeline/response` | The valibot schema of the timeline a page reads (`readApi(url, 'timeline', RESPONSES.timeline)`), shared with the hub, so the data is parsed, not cast |
| `web/src/components/Freshness.astro`, `web/src/lib/freshness.ts` | «Sist registrert for … siden» under the log's heading: a server island (`server:defer`), because the page is kept at the edge for minutes and this line is not |
| `web/src/server/api.ts`, `timeline.ts`, `snapshot.ts` | `timeline.json`: the newest of each service (`@designsystem/contracts/media-timeline`), merged newest first, the newest 50 (`TIMELINE_LENGTH`, equal to `TIMELINE_PER_SERVICE`) |
| `web/src/lib/moved-paths.ts` | Where the paths a media app moved away from go now |
| `web/src/server.ts` | `createIndexableAstroWorker(renderWithAstro)` from `@designsystem/config/indexable-astro-worker`, after the moved paths |
| `web/public/` | The picture used in link previews, the icons, `robots.txt`, `sitemap.xml` |
