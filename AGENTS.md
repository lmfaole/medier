# AGENTS.md

A public site on Cloudflare Workers: never commit a key or a token. Every setting is listed once in `src/lib/settings.ts` (a secret of the Worker, or of the repository for the
deploy; `npm run settings:push` sets them). Kept small on purpose; read `README.md` first.

- UI follows the design system's skills in `.claude/skills/` (`npm run skills`, checked in CI): components and tokens only, no `className`,
  `style` or stylesheet of our own, Norwegian bokmål on screen, run `designsystem-review` before calling UI work done. Motion and haptics too: brand motion only through the design system's
  signature parts (`FirstRun glyph`, `EmptyState glyph` on an app's first, empty start, one on a page), page changes by `transitionAttributes()` on `<html>`, buzzes by `data-haptic` or the components
  (README, «Brand»); no animation, duration or vibration of our own.
- Data: nothing is stored. A page asks its sources when it is asked for (`src/lib/sources.ts`, pure, with a test; `src/lib/runtime.ts` is the Worker's end), and the answers are kept in
  the Worker's cache for as long as each source's `TTL` says. Reading an API's answer is a pure function in `src/lib/` with a test next to it (`node --test`).
- A Worker on the lmfaole.party zone cannot reach Last.fm, Trakt, TMDB, Spotify or MusicBrainz (525): everything goes through the relay in `upstream/`, which allows only those hosts and only with the key the
  two share. A new source is: a parser and its test in `src/lib/`, a loader in `src/lib/sources.ts`, its host in `upstream/worker.ts` (and its test), its setting in `src/lib/settings.ts`, and a section.
- The main picture of a page, and only it, is lit (design system, «Light and shadow»): a `Picture size="hero"` on its frame, and the front page's record on its surface; a page of a detail component has its head as an island, `<Head client:idle … />` with the page `bare` (`src/pages/head.test.ts`): the picture and the name together on a WebGL backdrop of the picture's colours, in the full text colour. Nothing is painted over a Spotify picture; the disc is made of Last.fm's cover.
- The site is public and shows the visitor's own data: their Last.fm and Trakt usernames, from cookies (`src/lib/users.ts`), threaded through every loader (`forUsers`); no username, no data, but a form. Only public data, with the site's keys; nothing personal is kept by a shared cache (`src/middleware.ts`, `public/sw.js`). A source is never given more permission than it needs.
- Check before saying done: `npm test`, `npm run typecheck`, `npm run build`, and look at the page in a browser (`npm run dev`, or `npm run preview` for the Worker as it runs), phone width too.
