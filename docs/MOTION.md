# Motion: small, meaningful, and off on request

Applies to every app in `apps/*`. The tokens and classes are in
`src/motion.css` of the design system (`@lmfaole/designsystem`), which its `theme.css` imports, so every app has them.

## The rule

Motion carries information or it is not there. A movement is right when it
shows one of these:

- **Cause**: something appeared or left because of what the user did (a sheet,
  a menu, a toast).
- **Continuity**: a value or position changes in place (a count, a share bar,
  a block opening).
- **State**: the page is refetching, a thing is live, a control is pressed.
- **Orientation**: a list arrives on first view, a few steps apart.

## When not to animate

- Anything the user reads or acts on at speed: table rows, form fields, a
  navigation target, error pages. Hover and focus colour changes are fine;
  movement is not.
- A repeat. An entrance plays once per mount, never on a refetch, sort, filter
  or page change.
- Decoration with no meaning, and any loop other than `motion-live` and a
  spinner.
- A fade on text. A contrast checker (axe) reads half-transparent text mid-fade
  as a failure. Entrances move and do not fade. Overlays and the pending state
  of a container may fade.
- Layout properties (`width`, `height`, `top`, `left`). Animate `transform`,
  `translate`, `scale`, `opacity` and registered custom properties; for a block
  that opens, use `motion-collapse` (grid rows).

## Tokens

Durations and easings come from the tokens and nowhere else.

| Token | Value | For |
| --- | --- | --- |
| `--motion-duration-instant` | 100 ms | press, hover |
| `--motion-duration-fast` | 150 ms | menus, tooltips, the pending fade |
| `--motion-duration-base` | 250 ms | sheets, collapse, lift |
| `--motion-duration-slow` | 450 ms | entrances, bars growing |
| `--motion-duration-live` | 2400 ms | the live pulse |
| `--motion-ease-out` | | things arriving |
| `--motion-ease-in` | | things leaving |
| `--motion-ease-in-out` | | movement in place |
| `--motion-distance` | 0.75 rem | how far an entrance travels |
| `--motion-stagger` | 60 ms | the step between siblings, six steps at most |

## Components and classes

- `Reveal` and `Stagger` (`@lmfaole/designsystem/components/reveal`): one block, or a
  list or grid whose children come in one after the other.
- `CountUp` (`.../count-up`): a number that counts up, in CSS alone (a registered integer
  and a counter); the formatted final text is in the HTML and takes the climb's place when it ends.
  Any animated text value needs such a static twin.
- `LiveDot` (`.../live-dot`): the pulsing dot beside live data, with the word
  "live" or a time in text next to it.
- `Overlay` (a native `<dialog>`) (`.../overlay`, `overlay.css`): a transition from
  `@starting-style`, with `display` and `overlay` transitioned discretely so the closing one stays until it has left. The
  backdrop fades, a sheet slides and a dialog scales, all on tokens; the reduced-motion net covers `::backdrop` too.
  `motion-rules.test.ts` reads apps only, so it does not check `packages/ui` or the design system.
- Classes for the rest: `motion-reveal`, `motion-stagger`, `motion-grow` (set
  `--share` from 0 to 1), `motion-live`, `motion-pending`, `motion-press`,
  `motion-lift` (pointer devices only) and `motion-collapse`.

## Reduced motion

`motion.css` ends with a safety net: under `prefers-reduced-motion: reduce`
every animation and transition lands at once and loops run once, including the
generated shadcn components. The tokens collapse to `0.01ms` too. A spinner
that shows work is going on is feedback, not decoration: mark it
`data-motion="essential"` and it keeps turning.

Information must not live only in motion. A count has its final value in
`sr-only`, a refetch has `aria-busy`, a live dot has a label next to it.

## What enforces it

`scripts/motion-rules.test.ts` fails on a literal duration, `transition-all`,
an own `@keyframes`, or a looping `animate-*` without `data-motion="essential"`
in any app's `web/src`. A file that really needs its own motion is listed in that test with a reason.
The design system's `src/motion.test.ts` checks the tokens, the safety net and that an
entrance does not fade. `e2e/motion.spec.ts` runs the pages with reduced motion.

## What this does not change

The generated files in the design system's `src/components/ui/` keep their own
animation classes; the safety net makes them obey reduced motion. There is no
motion library. The only page transition is the browser's own cross-fade between two pages
(`@view-transition { navigation: auto }` in `shell.css`), which is off under `prefers-reduced-motion`.
