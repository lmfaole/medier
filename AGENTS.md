# AGENTS.md

A static site, public: never commit a key or a token (they are Actions secrets). Kept small on purpose; read `README.md` first.

- UI follows the design system's skills in `.claude/skills/` (`npm run skills`, checked in CI): components and tokens only, no `className`,
  `style` or stylesheet of our own, Norwegian bokmål on screen, run `designsystem-review` before calling UI work done.
- Data: one JSON file per source in `data/`, written only by `scripts/fetch.ts`. Reading an API's answer is a pure function in `src/lib/`
  with a test next to it (`node --test`).
- A new source is: a parser and its test in `src/lib/`, a call in `scripts/fetch.ts`, its secret in the workflow and the README, and a section.
- Check before saying done: `npm test`, `npm run typecheck`, `npm run build`, and look at the page in a browser (`npm run dev`), phone width too.
