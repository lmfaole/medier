# Overlay foundation Implementation Plan

> **Superseded 2026-10-30:** the overlays were rebuilt on the browser's own `<dialog>`, `popover` and invoker commands (`docs/UI-COMPONENTS.md`, "Overlays are the browser's own"). The Radix `Dialog`/`Sheet` and `useOverlayHistory` described here were deleted; Back no longer closes an overlay.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `Dialog` and `Sheet` primitives plus a back-button hook in `packages/ui`, ready for parts 2-4.

**Architecture:** Generated shadcn `dialog` and `sheet` (Radix) in `packages/ui/src/components/ui/`; a pure, testable history controller and a thin React hook around it in `packages/ui/src/lib/use-overlay-history.ts`. No app changes, so no deploy.

**Tech Stack:** shadcn `radix-nova`, `radix-ui`, React 19, TanStack Router history, `node --test`.

**Spec:** `docs/plans/2026-10-30-overlay-foundation.md`

## Global Constraints

- Generated files in `packages/ui/src/components/ui/` are never hand-edited (AGENTS.md).
- Hooks start literally with `use`; no `console.log`, `any`, non-null assertions.
- Durations and easings only from `--motion-*` tokens; entrances move and do not fade text; overlays and backdrops may fade (`docs/MOTION.md`).
- Close button target at least 48px (`docs/NAVIGATION.md` rule 5).
- Comments explain why, at most three lines in code; English identifiers and comments, Norwegian on-screen text.
- Work on `main`, no PR; `npm run affected` between edits, `npm run verify` once at the end. `dupes` is 0.66% against 0.65 on HEAD already: this work must not raise it.

## Review Focus

- Overlay unmounts while open (route change): the pushed entry is removed, no stray history entry.
- Opened and closed in the same tick (React StrictMode mount, unmount, mount): at most one entry is ever pushed.
- Closed by Esc or backdrop: back is called once and the controller's `onBack` is not called.
- Two overlays open at once: closing the top one pops only its own entry.
- Page reloaded with a stale overlay marker in `history.state`: it opens closed and pushes nothing.
- TanStack Router keeps working: its `history.state` fields survive our pushed entry, and Back lands on the page before the overlay.

---

### Task 1: Add `dialog` and `sheet`

**Files:**
- Create (generated): `packages/ui/src/components/ui/dialog.tsx`, `packages/ui/src/components/ui/sheet.tsx`
- Modify: `AGENTS.md` (the list of what `components/ui/` holds), `docs/plans/2026-10-30-overlay-foundation.md` (correct two assumptions)

**Interfaces:**
- Produces: `@designsystem/ui/components/dialog` (`Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogClose`) and `@designsystem/ui/components/sheet` (same names with `Sheet`, `SheetContent` taking `side`). The wildcard `./components/*` in `packages/ui/package.json` already resolves both; no export line is added.

- [ ] **Step 1:** In `packages/ui`, run `npx shadcn@latest add dialog sheet`. Expected: the two files appear under `src/components/ui/` and `radix-ui` is not re-added.
- [ ] **Step 2:** Read the generated `sheet.tsx` `SheetContent`. Confirm the `side="bottom"` variant exists and note whether the close button is at least 48px; if not, record both facts in the spec's "Open questions" resolved, and fix by a rule in `src/motion.css` or a `className` at the call site in part 2 (never by editing the generated file).
- [ ] **Step 3:** Run `npm run affected`. Expected: lint and typecheck of `ui` pass (the shadcn directory is a lint `override`). `scripts/motion-rules.test.ts` only scans `apps/*/web/src`, so literal `duration-*` classes in the generated files are not flagged; if oxlint or the test flags them anyway, stop and report instead of editing them.
- [ ] **Step 4:** In the spec, replace "Each gets an export entry in `packages/ui/package.json`" with "The `./components/*` wildcard already resolves them", and replace the open questions with what Step 2 found. In `AGENTS.md`, add `dialog, sheet` to the list of what `components/ui/` holds.
- [ ] **Step 5:** Commit: `git add packages/ui AGENTS.md docs/plans` with message `UI: dialog and sheet (shadcn) are added to packages/ui`.

### Task 2: `useOverlayHistory`

**Files:**
- Create: `packages/ui/src/lib/use-overlay-history.ts`
- Test: `packages/ui/src/lib/use-overlay-history.test.ts`

**Interfaces:**
- Produces:
  - `export interface HistoryHost { readonly state: unknown; pushState(state: unknown, unused: string): void; back(): void; addEventListener(type: "popstate", listener: () => void): void; removeEventListener(type: "popstate", listener: () => void): void }`
  - `export function openOverlayEntry(host: HistoryHost, onBack: () => void): () => void`: pushes one entry at once whose `state` is the current state plus `{ overlayEntry: <unique id> }` (so TanStack Router's own fields survive); returns `release`. When a `popstate` arrives and `host.state` no longer carries our id, it calls `onBack` once and detaches. `release()` detaches, and calls `host.back()` only if `host.state` still carries our id; it is safe to call twice.
  - `export function useOverlayHistory(open: boolean, onClose: () => void): void`: when `open` turns true it schedules `openOverlayEntry(window.history-and-window host, onClose)` with `setTimeout(0)`, and the effect cleanup cancels a not-yet-run timeout or calls `release`. It does nothing on the server (guard `typeof window`).

- [ ] **Step 1: Write the failing tests** with a `FakeHost` (a stack of states, `pushState` appends, `back` pops and then fires listeners, `emit()` helper) in `use-overlay-history.test.ts`:
  - `pushes one entry that keeps the existing state fields`: host state `{ __TSR_index: 3 }`; after `openOverlayEntry`, top state has `__TSR_index: 3` and an `overlayEntry` id; stack length +1.
  - `back closes the overlay once`: `host.back()`; `onBack` called once; a second `back()` does not call it again.
  - `release pops its own entry and does not call onBack`: stack length returns to the start; `onBack` not called.
  - `release twice pops once`.
  - `release after the entry was already popped does not call back`: after Back, `release()` leaves the stack unchanged.
  - `two overlays: releasing the top one pops only its entry`: open A then B, release B; top state carries A's id.
  - `a stale marker in the starting state does not count as ours`: host starts with `{ overlayEntry: "old" }`; `release()` of a new entry pops exactly one.
- [ ] **Step 2:** Run `node --test packages/ui/src/lib/use-overlay-history.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement `openOverlayEntry` against the interface above (unique id by a module counter; state check by reading `overlayEntry` from `host.state` through a small valibot or `typeof` narrowing, no assertions).
- [ ] **Step 4:** Run the same command. Expected: PASS, all seven.
- [ ] **Step 5:** Implement `useOverlayHistory` (effect keyed on `open`; keep `onClose` in a ref so a new callback does not re-push). No unit test for the hook itself: its logic is the tested controller plus a timer; Task 3 covers it in a browser.
- [ ] **Step 6:** Run `npm run affected`. Expected: all ok.
- [ ] **Step 7:** Commit: `git add packages/ui` with message `UI: useOverlayHistory lets Back close an overlay that has no URL`.

### Task 3: Prove it in a browser, document, verify

**Files:**
- Create then delete: `apps/forside/web/src/routes/overlay-scratch.tsx` (scratch page, never committed)
- Modify: `docs/UI-COMPONENTS.md`, `docs/MOTION.md`

**Interfaces:**
- Consumes: `Sheet`, `Dialog`, `useOverlayHistory` from Tasks 1-2.

- [ ] **Step 1:** Add the scratch route in `apps/forside` with a button that opens a bottom `Sheet` and one that opens a `Dialog`, each driven by `open` state and `useOverlayHistory(open, () => setOpen(false))`, each with a `SheetTitle`/`DialogTitle`.
- [ ] **Step 2:** Start `npm run dev` in `apps/forside`. With the Playwright MCP (or the repo's Playwright and Chromium, saying so if the MCP cannot start): at desktop and 390px width open each overlay; press Esc (focus returns to the button, history length unchanged from before opening); open and press Back (overlay closes, URL and page unchanged, no navigation away); open, click the backdrop; open, navigate to another route by link (no stray entry on Back); take a screenshot of each at both sizes; read `browser_console_messages` for errors and run axe on the page with an overlay open.
- [ ] **Step 3:** If Back leaves the page or TanStack Router logs an error, stop and report with the console output: the fallback is to push through the router's history (`router.history.push`) instead of `window.history`, which changes the `HistoryHost` adapter only, not the controller.
- [ ] **Step 4:** Delete the scratch route and regenerate nothing by hand; confirm `git status` shows no `apps/forside` change.
- [ ] **Step 5:** In `docs/UI-COMPONENTS.md` add a short "Overlays" section: Sheet from the bottom on a phone and Dialog on desktop, title required, `useOverlayHistory` for overlays without a URL (not for the URL-addressed detail of part 4). In `docs/MOTION.md` add one line under Components that the generated dialog and sheet follow the shared tokens and reduced-motion net.
- [ ] **Step 6:** Run `npm run verify`. Expected: lint, typecheck, test, build, clippy, cargo test and the diff gate pass; `dupes` is no worse than 0.66% (it fails on HEAD already, say so).
- [ ] **Step 7:** Commit: `git add docs packages/ui` with message `Docs: overlays (dialog, sheet, back button) and when to use which`. No deploy: no app's files changed.
