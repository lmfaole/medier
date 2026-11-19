# CSS layout: grid first, named areas

Applies to every app in `apps/*`.

## The rule

Reach for CSS Grid before Flexbox when laying out a page, a section, or any
component made of a few distinct, named regions (a header, sidebar, content
area, toolbar, footer, ...). Flexbox stays the right tool for the cases it
is actually good at: aligning a run of same-kind items along one axis — a
row of nav links, a button group, a header's "title on the left, controls on
the right" split, centering a single child. If you're stacking or aligning
things that don't have distinct roles, Flexbox is fine. If you're arranging
things that *do* have distinct roles, use Grid and name them.

The point of naming areas is that the layout's shape should be readable
directly from the CSS/Tailwind classes, without having to trace nested
`<div>`s to work out what sits where.

## Named grid areas in practice

For a two- or three-column dashboard shell, prefer an explicit
`grid-template-areas` over nested flex wrappers:

```tsx
// Readable at a glance: a sidebar, a header next to it, content below.
<div
  className="grid min-h-dvh grid-cols-[16rem_1fr] grid-rows-[auto_1fr]
             [grid-template-areas:'sidebar_header'_'sidebar_main']"
>
  <aside className="[grid-area:sidebar]">...</aside>
  <header className="[grid-area:header]">...</header>
  <main className="[grid-area:main]">...</main>
</div>
```

```css
/* Equivalent plain CSS, worth switching to once the Tailwind arbitrary-value
   string gets hard to read (more than ~3 areas, or a responsive variant per
   breakpoint). Keep it next to the component it belongs to. */
.dashboard {
  display: grid;
  grid-template-columns: 16rem 1fr;
  grid-template-rows: auto 1fr;
  grid-template-areas:
    "sidebar header"
    "sidebar main";
  min-height: 100dvh;
}
.dashboard-sidebar { grid-area: sidebar; }
.dashboard-header { grid-area: header; }
.dashboard-main { grid-area: main; }
```

Either form is fine — pick whichever stays readable. What isn't fine is the
same layout built from several levels of `flex` + `flex-1` + manually-ordered
markup, where you have to read every wrapper to find out that one of them is
actually the sidebar.

## Bleeding out of the page column

`AppLayout` puts the page in `PAGE_COLUMN`, which has **no maximum width** (README rule 7 of the design system: wide screens get more columns, never empty margins; `Grid`, `Split` and `LIST_COLUMNS` are how) and makes `<main>` a container named `page`. A page that wants to run edge to edge sets `margin-inline: calc(50% - 50cqw)` on its root; `cqw` is the page area without the scrollbar, which `100vw` is not. Give the bleeding sections their own grid and padding rather than a subgrid of a wider one: a subgrid does not inset its items by its own padding.

## Wide screens

The page column has no maximum width, so nothing may rely on one. The rules, kept by `scripts/desktop-width.test.ts` here and `src/desktop.test.ts` in the design system:

- No `max-w-*` on a layout: only the measure of a line of text (`max-w-prose`) or a heading.
- Lists of rows flow into columns (`LIST_COLUMNS`); parts of a page sit side by side with `Grid columns="sections"`/`"charts"` or `Split` (a sticky rail), by the room they have (container queries), not by the window.
- A page is checked at 1920 and 2560 px as well as on a phone (`npm run page-check`, or a screenshot at that width).

## What this does not change

- Generated shadcn layouts keep the layout they ship with; restyle nothing in
  the design system's `src/components/ui/`, it is regenerated.
- `grid-cols-2 md:grid-cols-4 gap-4` for a repeated run of same-shaped cards
  (stat cards, top lists) is a grid already, and doesn't need named areas —
  the cells are interchangeable, there's no distinct "role" to name.
- This is a convention, not an enforced lint rule: oxlint does not check
  CSS/Tailwind class usage. Code review is where this gets caught.
