# Overlay foundation: dialog and sheet in `packages/ui`

> **Superseded 2026-10-30:** the overlays were rebuilt on the browser's own `<dialog>`, `popover` and invoker commands (`docs/UI-COMPONENTS.md`, "Overlays are the browser's own"). The Radix `Dialog`/`Sheet` and `useOverlayHistory` described here were deleted; Back no longer closes an overlay.

Status: spec, 2026-10-30. Part 1 of 4 of "the services feel more like an app".

## Intent

The owner wants the apps to feel like apps, mainly on a phone: detail, choices and
navigation open over the page instead of replacing it. Agreed order, each part its own
spec, plan and commit:

1. **This spec:** the `Dialog` and `Sheet` primitives, and what they need to be
   safe and app-like (focus, Esc, back button, motion).
2. Period and view pickers as a bottom sheet on a phone; lightbox for posters and
   covers; small confirmation dialogs.
3. App menu as a sheet (changes the "no menu, no tab bar" rules in `docs/NAVIGATION.md`;
   `lib/apps.ts` stays the only source).
4. Detail from lists as an overlay with its own URL (nested route or search parameter
   primed by the loader), so the back button closes it and a shared link opens it.

Assumptions, not stated by the owner: the no-JavaScript rule is gone (removed 2026-10-30),
so overlays may require scripts; apps stay public with no login.

## Scope

In: generated shadcn `dialog` and `sheet` (style `radix-nova`, `packages/ui/components.json`),
a small hook for the back button, motion integration, docs and tests.
Out: any use in an app, the URL-addressed detail overlay, drawer with drag-to-dismiss,
command palette, manifest and offline shell.

## Design

### Primitives

- Add with `npx shadcn@latest add dialog sheet` in `packages/ui`. Files land in
  `src/components/ui/` and are never hand-edited (AGENTS.md). The `./components/*` wildcard in
  `packages/ui/package.json` already resolves them. Radix is already a dependency
  (`radix-ui`); apps still reach it only through `packages/ui`.
- Both are Radix `Dialog` underneath, so focus trap, `Esc`, scroll lock, `aria-modal`
  and return of focus to the trigger come for free. Every use must have a title
  (`DialogTitle` / `SheetTitle`, `sr-only` allowed) and a description or
  `aria-describedby={undefined}` on purpose.
- A phone shows a `Sheet` from the bottom (`side="bottom"`), at most 90% of the
  viewport height, scrollable inside. A desktop shows a `Dialog`. The switch between
  the two is made by part 2's callers; this part only guarantees both work.

### Back button: `useOverlayHistory`

`packages/ui/src/lib/use-overlay-history.ts`. For overlays that have no URL (parts 2
and 3): when it opens it pushes one history entry, and a back navigation closes it
instead of leaving the page; closing by Esc, backdrop or button removes that entry
(`history.back()` only if it is still the top). It must not break part 4's
URL-addressed overlay, which does not use it. Name starts with `use` (oxlint).

### Motion

`docs/MOTION.md` already names "a sheet" as cause-motion at `--motion-duration-base`.
Overlay and backdrop may fade (the rule forbids fading text, not overlays); content
moves with `transform` only. The generated components carry Tailwind animation
classes with literal durations: if `scripts/motion-rules.test.ts` fails on them, fix it
in `motion.css` (classes bound to the `--motion-*` tokens, applied by data-state
selectors) rather than editing the generated files. Reduced motion is already handled
by the net at the end of `motion.css`.

### Accessibility

Touch targets of at least 48px for the close button (matches `docs/NAVIGATION.md`
rule 5). Focus moves into the overlay on open and back to the trigger on close.
The page behind is inert (Radix does it). `e2e/a11y.spec.ts` axe run must pass with an
overlay open.

## Files

- New: `packages/ui/src/components/ui/{dialog,sheet}.tsx` (generated),
  `packages/ui/src/lib/use-overlay-history.ts` and its test.
- Changed: `packages/ui/package.json` (exports), `packages/ui/src/motion.css` if
  needed, `docs/UI-COMPONENTS.md` (when to use dialog vs sheet), `docs/MOTION.md`
  (one line), AGENTS.md list of what `components/ui/` holds ("button, button-group, card,
  native-select, separator, skeleton, table" plus dialog, sheet).

## Testing

- Unit (`node --test`): `use-overlay-history` pushes once, a back event closes, and
  closing by other means pops the entry it pushed without double-navigating. Logic with
  branches and a boundary, so it earns a test.
- Browser, through the Playwright MCP against `npm run dev`: a throwaway story is not
  added to an app; part 2 is the first real use. For this part, verify with a minimal
  trigger in a dev-only scratch page that is deleted before the commit, check console
  for errors and take screenshots on desktop and phone width. Say so if the MCP cannot
  start a browser.
- `npm run verify` stays green. `dupes` is already 0.66% against 0.65 on HEAD (not
  caused by this work); a change here must not raise it.

## Deliberately not done

- Drag-to-dismiss (vaul) and gestures: a new dependency outside the Radix setup,
  revisit if a sheet without swipe feels wrong on a phone.
- Uses in apps: parts 2-4.
- No deploy: nothing in an app changes in this part.

## Resolved while planning

- `scripts/motion-rules.test.ts` only scans `apps/*/web/src`, so the generated files are not checked.
- The generated `sheet` has a `side="bottom"` variant with `h-auto` and no height cap, and its
  close button is `icon-sm` (under 48px). Part 2 caps the height with a `className` on
  `SheetContent` and enlarges the close target with a rule on `[data-slot="sheet-close"]`
  in `motion.css`'s sibling stylesheet, never by editing the generated file.
