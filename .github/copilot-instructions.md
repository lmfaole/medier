# Copilot instructions for this repository

The rules for this monorepo live in `AGENTS.md` at the repository root, with
app-specific additions in each `apps/<name>/AGENTS.md`. Copilot reads
`AGENTS.md` too; this file only repeats the parts that matter most, so the
two cannot disagree on anything else.

- English for code: identifiers, comments, commit messages, docs. On-screen
  text is a product decision. See `docs/CONVENTIONS.md`.
- Prefer full, descriptive names. Never abbreviate identifiers.
- Comments explain why, not what, in at most three lines. Never comment out
  code.
- One job per file. Add a file rather than extending one that has a job.
- Test what you change. A test that passes both before and after the change
  does not test the change.
- One concern per commit. The message says why, not what the diff shows.
- Never commit a secret.
- Validate before declaring done: `npm run lint`, `npm run typecheck`,
  `npm test` and `npm run build` from the repository root.
