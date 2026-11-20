# AGENTS.md

A public site on Cloudflare Workers: never commit a key or a token. Every setting is listed once in `src/lib/settings.ts` (a secret of the Worker, or of the repository for the
deploy; `npm run settings:push` sets them). Kept small on purpose; read `README.md` first.

- UI follows the design system's skills in `.claude/skills/` (`npm run skills`, checked in CI): components and tokens only, no `className`,
  `style` or stylesheet of our own, Norwegian bokmål on screen, run `designsystem-review` before calling UI work done.
- Data: nothing is stored. A page asks its sources when it is asked for (`src/lib/sources.ts`, pure, with a test; `src/lib/runtime.ts` is the Worker's end), and the answers are kept in
  the Worker's cache for as long as each source's `TTL` says. Reading an API's answer is a pure function in `src/lib/` with a test next to it (`node --test`).
- A Worker on the lmfaole.party zone cannot reach Last.fm, Trakt, TMDB or Spotify (525): everything goes through the relay in `upstream/`, which allows only those hosts and only with the key the
  two share. A new source is: a parser and its test in `src/lib/`, a loader in `src/lib/sources.ts`, its host in `upstream/worker.ts` (and its test), its setting in `src/lib/settings.ts`, and a section.
- The site is public: what is shown is what the owner is happy to show to anyone (what plays now included). A source is never given more permission than it needs (Spotify: `user-read-currently-playing` only).
- Check before saying done: `npm test`, `npm run typecheck`, `npm run build`, and look at the page in a browser (`npm run dev`, or `npm run preview` for the Worker as it runs), phone width too.
