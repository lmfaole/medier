# UI components

## The one hard rule: an app has no styling of its own

No file under `apps/<app>/web/src` writes `className`, `class`, `style` or CSS (its `index.css` only imports the theme).
Everything a page looks like comes from a component of `packages/ui` or of the design system (`@lmfaole/designsystem`), or a shared page of `packages/watch` / `packages/shelf`,
and `scripts/design-system.test.ts` fails on anything else; `.githooks/pre-commit` runs it on every commit (and the pre-push hook and CI run it with the rest of the tests). Its `ALLOWED` list is what was left when the rule came; it only shrinks.

How a page is put together without classes:

- **Layout:** `Stack` (under each other), `Inline` (next to each other), `Grid` (columns), `PageColumn` (the page's column),
  from `@lmfaole/designsystem/components/layout`. A gap is one of `none | xs | sm | md | lg | xl`; there is no other spacing. For wide screens (no page has a maximum width): `Grid columns="sections" | "charts" | "cards" | "tiles"` fit by room, `Split` puts a sticky rail (`EntityAbout inRail`, `PageRail`, `LinkRail` for links that are not an app's own pages) beside the one main column; `docs/CSS-LAYOUT.md`, "Wide screens".
- **Text:** `Text` (`size`, `tone`, `weight`, `numeric`, `truncate`), `Heading` (`level` is the element, `look` the appearance) and
  `TextLink`, from `@lmfaole/designsystem/components/text`.
- **Figures in a table:** `NumberHead` / `NumberCell`, from `@lmfaole/designsystem/components/number-cell`.
- **Everything else** is an existing component (`Rows`, `MediaRows`, `PageSection`, `PageHeader`, `FactList`, `SentenceCard`,
  `StatCard`, `Cover`, `Avatar` (a round picture, made of a span and an img so it may sit in a text), `AvatarList` (names under each other, each with its avatar and its count), `PeriodCard` (a week, a month or a year: its title, its plays with the change as an icon, and what led), `AppMark`, `AppList`, `MediaTimeline`, …). Look before making one.

When none fits, the markup moves into the design system repository when it is generic, into `packages/ui` when it knows about these apps; either way it is a component named for what it is (not for the app), with closed
props: a choice is a named variant (`size: "sm" | "md"`), never a `className` handed in from an app. A component that takes
`className` today keeps it for other components of `packages/ui` only.

## Group related actions with Button Group

Applies to every app in `apps/*` that uses `@designsystem/ui`.

## The rule

When a page offers two or more controls that act on the same thing — a
select paired with the button that applies it, a set of view-toggle
buttons, an input with its submit action — wrap them in
`ButtonGroup` (`@lmfaole/designsystem/components/button-group`) instead of a
bare `flex items-center gap-2` row. The group's border-merging and shared
focus ring make the relationship visible without a caption; a loose flex
row of the same controls reads as unrelated buttons that happen to sit next
to each other.

```tsx
import { ButtonGroup } from "@lmfaole/designsystem/components/button-group"

<ButtonGroup>
  <NativeSelect value={templateId} onChange={(event) => setTemplateId(event.target.value)} className="w-56">
    <NativeSelectOption value="a">...</NativeSelectOption>
  </NativeSelect>
  <Button type="button" onClick={() => void applyTemplate()}>
    Apply
  </Button>
</ButtonGroup>
```

Use `ButtonGroupSeparator` to split a group into two logical clusters
without starting a second group, and `ButtonGroupText` for a non-interactive
label (a unit, an icon) that should still visually merge with the buttons
beside it.

## What this does not change

- A single standalone button, or one button next to unrelated content, does
  not need a group — there is nothing to group it with.
- A plain `flex items-center gap-2` row is still right for controls that
  are aligned but not acting on the same thing (see `docs/CSS-LAYOUT.md`'s
  "title on the left, controls on the right" header split).

## Long explanations belong in a modal, not inline

A control group should stay self-explanatory from its label and the
surrounding page — it does not need a paragraph of prose sitting next to it
every time it's used. If a control needs real explanation (what a
budgeting-scheme template assumes, what a bulk action will overwrite), put
that text in a `Dialog` behind a
small "?" button next to the group, rather than printing it inline. See
the removed budget app's scheme-selector group (git history) for the
pattern.

## Overlays are the browser's own: dialog, popover and invoker commands

A box over the page is a `<dialog>` (`Overlay`, `@lmfaole/designsystem/components/overlay`), and something light that hangs
off a button is a `popover`. Both are opened and closed by invoker commands, `CommandButton`
(`<button command="show-modal" commandfor="id">`), so there is no `open` state in React, it works before the scripts
have loaded, and the browser does focus, the top layer, Esc and the inert page behind. A browser without invoker
commands (Safari before 26.2, Firefox before 144) gets the same from a click handler in `CommandButton`. `Overlay`
takes a `variant` (`dialog`: a box in the middle, `sheet`: from the bottom of the screen) and a required `title`
(`hideTitle` keeps it for a screen reader only). Look and motion are in the design system's `src/overlay.css`: a transition from
`@starting-style` on `--motion-*` tokens, `display` and `overlay` transitioned discretely, and a 48px close button.

`CoverLightbox` (used by `EntityHero`) is the example of a dialog. A list of choices is never an overlay: it is a native `<select>`.

Not done: Back (the browser's button on a desktop, the swipe on iOS) does not close an overlay; Esc and the Android
back gesture do. The `<dialog closedby>` attribute is set, but Safari may not know it, so a click on the backdrop also
closes through a handler. The stored covers are about 250px, so the lightbox shows them at up to 24rem, a little soft.

## A thing's page

A link to a thing is a link to its own page, `/<kind>/<slug>` under the app's base (`pageHref` in `lib/detail-state.ts`;
the shelf apps' kinds `game`, `book` and `boardgame` are at `/spill`, `/bok` and `/brettspill`). It is a page like any other:
a full load, Back returns to the list. The card that once opened over the list (`?kort=<kind>.<slug>`, until 2026-11) is
gone; the media server answers its old address 301 to the page (`detailOf` and `pagePath`, `scripts/media-router.ts`).

## Detail pages

The page of a thing is one anatomy for every kind (film, tv, person, place, book, game, boardgame, show, episode, artist, album,
song, collection, concert), drawn by `EntityView` from an `EntityModel`; the data decides the content, never the page.

1. **Head.** `EntityHero` / `EntityCoverHero`: the picture and the name as the page's only `h1`.
2. **Numbers.** The model's `tiles` in one row under the head, for every kind, never in the rail: what the log says (how often, first and last, where, amount), what the register says as a length (running time, seasons), and last `Eier` where the owner has it (`tilesOf`; ownership is never in the rail). A log shorter than three days or months is no section: its counts are these tiles.
3. **Body.** On a wide screen two columns (`Split`): a fixed-width sticky **rail** on the left and **one main column** on the right; on a
   narrow screen the rail comes first. The rail is the about (`EntityAbout`: the kind label, subtitle, text, rating, facts, links, the
   maker's mark), a map and the credit. It never holds a section, and a page with nothing for it has none (`hasRail`):
   the main column then has the whole width, and a page with no sections has the about across it. A poster cover (book, game) is drawn narrower than a square one so the head stays about as high.
4. **Main column.** The sections one under the other, each as wide as the column, each an `h2` in the same look and the same gap:
   `mainSections` puts the owner's own first (`band: "mine"`: the log, a chart of plays, how it was seen, what was heard; a log, a
   chart and achievements are `mine` by their kind) and then what the thing holds (`band: "about"`: lead, cast, crew, tracks,
   franchise, related, gallery), each band in the order the model gave. Nothing stands side by side except two consecutive short `factlist`/`text` sections of one band (at most `PAIR_MAX` = 8 lines each, lengths within `PAIR_SPREAD` = 2 of each other: `mainBlocks`), which share the column in two equal columns; inside a section the content flows
   into columns instead (`LIST_COLUMNS`). A chart has the width of the column, no card of its own, in the series colour (`--series-1`) unless the model gives one, never the page's black.
5. **Content shapes.** People are `rows` (a name, its role as `detail`), never a wide table: a `table` is for real tabular data (the
   votes of a board game). A list has a picture column only where every row has a picture, a gallery with a missing picture is a list
   of names, and an achievement without an icon has no box: no grey placeholders.
6. **Levels.** `h1` the name, `h2` a section (the label look), a small label for a fact and for the kind. No other level on a page.

A model orders nothing itself beyond giving `band` where the kind is not enough; a new kind of page is a model, not a layout.

## A page edits settings, never the data it shows

An app reads its data and never writes it (`AGENTS.md`), so no page has an
"Add", "Edit" or "Remove" control for a row: the rows are filled offline
(`docs/DATA.md`). What a page does own is the few preferences that follow the
user — a sort order, a theme — and those go through `useUserSetting`.

A preference with more than one control belongs in a focused `Dialog` rather
than inline on a page already dense with numbers, where it would compete with
the data for attention. See
the removed dashboard's settings dialog (git history) for the pattern: one
component per dialog, whose form lives inside `DialogContent`, so every
opening starts from fresh values.

## Keep a card or dialog's view toggle and primary actions inline with its title

A card's or dialog's header row is where the eye lands first, so any
control that changes what's shown (a month/year `PeriodToggle`) or acts on
the whole form (`Save`, `Cancel`) belongs there, next to the title — not
buried inside the field grid below, and not alone at the bottom of a long
form the user has to scroll past. Put the toggle and actions in `CardAction`
(give it `className="flex items-center gap-2"`, since it has no `flex` by
default) for cards, or in a horizontal `DialogHeader`
(`className="flex-row items-center justify-between space-y-0"`) for
dialogs. A `Save` button that lives outside the `<form>` element still
submits it via the HTML `form="<form-id>"` attribute. See
the removed budget app's granularity toggle (git history)
and the removed dashboard's settings dialog for the pattern.

## Extract a layout primitive the moment the same semantic thing drifts

When two call sites — in one app or across several — render the same kind
of thing (a filter chip, a view-toggle, a card's action row, a dialog's
footer, a labeled stat) by hand instead of through one shared component,
the markup drifts: a font-weight here, a missing `flex` there, a button
order that's `Cancel`/`Save` in one dialog and `Save`/`Cancel` in another.
None of these are visible in a single file's review — only by comparing
two call sites side by side. Pull the primitive into
the design system when it is generic, or `packages/ui/src/components` when it knows about these apps, as soon as you notice the second call site,
rather than letting a third and fourth copy the drift further.

This is "Refactor on contact" (`docs/CONVENTIONS.md`) applied specifically
to UI: the violation is duplicated markup for one semantic thing, and the
fix is a component, not a shared CSS class or a copy-pasted snippet.

### How to tell it's a primitive, not a page

- It has no knowledge of what app it's in — it takes data and callbacks
  (`label`, `value`, `onChange`), never a Kroner-formatter or a route.
- It would read the same in a dialog in `budget` and a card in `music`.
- Its own prop names describe what it does (`SegmentedToggle`'s `options`),
  not where you clicked to make it (`CategoryFilter`'s `categories`) — the
  latter is still app-specific even once extracted, which just moves the
  duplication into the design system instead of removing it.

### Primitives extracted so far, as a reference for what counts

- `SegmentedToggle` — an either/or view switch ("Per month" / "Per year")
  built on `ButtonGroup`, with exactly one option always active.
- `ExternalLink` — a link off the app: underlined, and with a `rel` the call site cannot opt out of.
- `StatCard` — one labeled headline number in a `Card`; `value` accepts a
  `ReactNode` so a call site can still tint it (an income/expense color)
  without forking the component.

### Migrating an app takes the shared primitive, differences and all

This is the same rule seen from the other side, and it is the part that is easy
to get wrong. When an app moves onto the design system, the temptation is to
port its markup across intact: it works, it looks identical, and nothing forces
the question. But the differences that survive a migration are usually the ones
nobody chose — a `pl-3` here, a `text-xs` there, a hand-rolled guard for a
null the primitive already handles.

So when the app's version differs from the shared one only by padding, margins,
a color, a font size, or a few lines of simple logic, **take the shared
primitive and drop the difference.** The design system is documented and
maintained as one thing; three near-identical variants of a link is three things
to document, three to change, and one of which was always going to be wrong.
Write the app's version as a primitive when it is the first of its kind, not as
a copy the next app will match.

The line is drawn at meaning, not at similarity. Keep the difference when it
carries something a reader of the app would notice and a shared component
should not know about: which fields a CV row shows, what a section
says, what a page's lead is. Keep it when the app is the only call site and the
component would be invented for one caller.

### What this does not change

Page-specific composition — which fields a form has, what a page's title
and lead say, how its data is fetched — stays in the app. Extracting a
primitive removes the *drift* between call sites, not the call sites
themselves; a page built entirely from shared primitives is still that
page's own file, wiring its own data into them.


## Every app has an icon and a colour

Each app has one icon and one colour, defined once: `APPS` in
`packages/ui/src/lib/apps.ts` and the `--app-<id>` tokens in
`packages/ui/src/theme.css`. They are how one app recognises another, so
wherever an app points at something that lives in another, use them rather
than a grey label or a hand-picked colour:

- `AppMark`: the icon on a tile in the app's colour. `/medier` on `forside` uses
  it for each app it lists.
- A link into another app is a plain `<a>` at `appOrigin(<app>)`: that app's
  address in production, its own local port under `astro dev`; `pageHref` takes
  it to one of the app's pages. "The rest of this is over there" is always
  this, and `/medier` is the one page that does it today.

Put `data-app="<id>"` on an element and `--app-color` is that app's colour for
it and everything inside, so `border-(--app-color)` or `bg-(--app-color)/10`
needs no per-app class names. Colour is never alone: the mark and the name
always go with it, and it is never used as text colour.

## Page chrome

`AppLayout` is the page itself, capped to the same width in every app, with the app's navigation (`AppNav`: a bar at the foot of the screen on a phone, a rail at the left from tablet width) and no
header, no theme toggle; at the top of an app's page are breadcrumbs (`AppBreadcrumbs`: where the page is, and on a phone the parent as a way back). An Astro page gets all of it from
`layouts/AppPage.astro`: `AppLayout` (the skip link, `<main>` and the sentence about the data from `parseFreshness`) is rendered
on the server with no script, and the breadcrumbs (`AppBreadcrumbs`) are rendered there too, as plain HTML: no island and no script.
The colours follow the device (`prefers-color-scheme` in `theme.css`). A page's own links come from the registry (`AppNav`, `AppSubPages`, `docs/NAVIGATION.md`). Moving between
pages uses the browser's own view transitions (`@view-transition` in `shell.css`), and Astro's `prefetch` fetches a page
on hover or focus. The sentence about how fresh the data is is a server island (`layouts/Freshness.astro`), read from the snapshot on its own request.

The page of one thing (a film, an album, a game) starts with `EntityHero`: full width (it bleeds out of the column and
up under its top padding), tall, centred, with the cover over a wide picture (`banner`: a backdrop, a screenshot, a
photo of the artist or author; its blurred cover where there is none) and the links out as pills (`links`). A page
puts its source links there, not in a `LinkList` under it.

## Charts

`column-chart`, `ranked-bar-chart`, `area-chart` and `stock-chart` (several series over one time axis, each scaled to its own peak, with a crosshair and ringed dots for events) are TanStack Charts, themed
through `chart-frame.tsx`. `donut-chart` is the exception: a ring of shares and
its legend in plain CSS (a `conic-gradient` and a grid), because it has to take
the page's own colours, which a Wrapped section sets as `--donut-base` and
friends, and because the legend is the data. A chart whose point is its shape
over time or across categories goes through `ChartFrame`; one that is a handful
of shares can be this.

A chart does not take keyboard focus (`ChartFrame` sets `keyboard: false`): only what can be clicked or typed in does, and `e2e/focus.spec.ts` fails on a page where anything else is reached by Tab. The tooltip stays with the pointer; the exact values are in a table a screen reader can move through, `ChartTable` (`chart-table.tsx`, rows from `lib/chart-rows.ts`), which every chart but the donut keeps in an `sr-only` box under it (the donut's legend is its data).

## Motion comes from the shared layer

Micro-animation uses the tokens, classes and components of the design system's
`src/motion.css` (`Reveal`, `Stagger`, `CountUp`, `LiveDot`), never a duration or a `@keyframes` of an app's own. It moves
and does not fade text, plays once per mount and is off under reduced motion.
When to animate and when not to: `docs/MOTION.md`.

## Error pages come from the design system

Every app shows the same 404, 500 and 403 pages, so an error looks like the
same site wherever it happens:

- **404:** `NotFoundPage` (`@lmfaole/designsystem/components/not-found-page`)
  is the content of each app's `pages/404.astro` (and of an island that finds nothing). Every app's `wrangler.jsonc` sets
  `"not_found_handling": "none"`: an unknown path is no file, so it reaches Astro, which renders the 404.
- **500, page crashed:** a page that throws while the Worker renders it is the Worker's 500 (below); `ServerErrorPage` is its content.
- **500, Worker threw:** every Worker exports
  `fetch: withServerErrorPage(handleRequest, HEADERS)` from
  `@designsystem/config/error-pages`, which answers the HTML twin of the
  page (or JSON under `/api/`) with the app's security headers.

A new kind of error page is a new component built on `ErrorPage`, plus its
wording in `error-pages.ts`, never a hand-rolled page in one app.

**Every list of choices is a native `<select>`, a fixed rule of the design system** (its README, rule 6): shadcn's `NativeSelect`
(`@lmfaole/designsystem/components/native-select`), never the Radix `Select`, a listbox or combobox, or a popover or sheet
of buttons or links drawn to look like one. On a phone it is the platform's own picker, however long the list. The period
of a page is a `PeriodPicker`, a `NativeSelect` whose options carry their address; `Document.astro` runs `enableNavigatingSelects`, so the page stays HTML.

## Pages and data go through Astro, set up by the design system

Every app runs on Astro 7 with React islands on Cloudflare Workers, rendering each page on the server. An app is
its pages, its SQL and its views; everything else is one of these:

- `createAstroConfig` (`@designsystem/config/astro-preset`) is the app's whole `astro.config.ts`: `base` is the
  app's route, the Cloudflare adapter reads `wrangler.jsonc`, `prefetch` fetches a page on hover, and
  `edgeCachedPages` lists the pages the edge keeps for minutes (`Astro.cache`).
- `createAstroWorker` (`@designsystem/config/astro-worker`) runs the shared pipeline of `createWorkerApp` first
  (crawler block, uptime path, the app's own prefix routes such as posters), then serves a file the asset store has from the
  store and hands every other path to Astro. The inline scripts of the islands are allowed in the CSP by hash
  (`inline-script-hashes.ts`); `createIndexableAstroWorker` is the same for `work` and `forside`.
- The whole JSON API is one endpoint, `pages/api/[...file].ts`, whose `GET` is `appApiHandler`
  (`@designsystem/config/app-shell/api`): `/api/<name>.json` is a file of the snapshot in the asset store, an unknown
  name is a 404. The files are written by `npm run snapshot` from `server/api.ts`.
- `readApi(url, file, RESPONSES.<file>, params)` and `readPage(url, request, schema)`
  (`@designsystem/config/astro-api`) read that same file while a page renders and parse it with the app's valibot
  `RESPONSES` (`server/responses.ts`, which `satisfies` the loaders' `ApiResponses`), so a page's data is parsed and not cast.
  A period or thing the snapshot has no file for is `Astro.cache.set(false)` and `notFoundPage()`.
- `cloudflareEnv<Env>()` (`@designsystem/config/cloudflare-env`): the Worker's bindings, for code that gets no `env`.
- `scripts/deploy-app.ts` refuses to deploy a config that binds a database, bucket or key-value store
  (`forbiddenBindings`, `@designsystem/config/bindings-config`): every app is public, so the snapshot is the only data a
  Worker holds. It also refuses a build that contains Astro's dev toolbar (`check-bundles.ts`). What a deploy does is
  `planDeploy` (`scripts/deploy-plan.ts`), and `npm run deploy -- --dry-run` prints it.

In the page, from `packages/ui`:

- `layouts/AppPage.astro` (`Document` + `AppLayout` + the breadcrumbs, `AppBreadcrumbs`, rendered on the server) takes `app`, `title`, `path`, `og` and
  `freshness`; `Document.astro` writes the head, the robots meta (one of the three not-indexed layers) and the theme
  colours. `lang` is stated by the app.
- The standard pages read through `lib/page-requests.ts` (`overviewRequest`, `libraryRequest`, `historyRequest`, ...) with
  the schemas of `lib/period-search.ts`, `library-search.ts` and `slug-params.ts`; the views are
  props-based components (`components/*-page.tsx`, `packages/watch|shelf/src/pages/*`) whose header comment names the
  client directive.
- **Islands.** A page is HTML until something needs a browser. Charts and long lists are `client:visible`; the library
  filter and the period picker are `client:idle`; `client:load` needs a comment that
  says why. Functions cannot cross the island boundary, so a small wrapper in `src/views/` builds the function props.
- **Period controls go to an address.** The steps and the tabs are plain `href`s (`searchHref`, `searchHrefHere` in
  `lib/href.ts`); `PeriodPicker` is a native `<select>` that goes to the same address from the document's script.
- **A thing's page.** A link to a thing goes to its own page (`pageHref`, `lib/detail-state.ts`); there is no card over a list.
- Anything an island renders must render on the server and again in the browser with the same
  result (`useTheme` and `useCountUp` are the examples): no `Math.random()` or clock in a first
  render, and no `window` outside an effect. `e2e/smoke.spec.ts` fails on a hydration message.

## Rows and columns are a table

Where every row is a name and what it has (a ranking, a list of tracks, a shift against the period before), it is a
`<table>`, so a screen reader hears each number with its column. `Rows` (rankings), `EntityRows` and
`ListenRows` (music) and `ChartTable` (every chart's values, hidden) are the tables. The look is not the table's: the
rows keep the grid they had, and the roles (`table`, `row`, `rowheader`, `cell`) are written out, so the table stays one
when `display` is not `table`; the headers are `sr-only` where the page shows no header. The name is the row header.
A key and its value is a `<dl>` (`FactList`), and a gallery, a menu or a set of links is a list; they stay so.
`e2e/tables.spec.ts` checks that a ranking has its «Antall» column.

## Lists, headings, links and chart cards are shared

What looks the same in two apps comes from `packages/ui` or the design system, so it stays the same:

- A titled block of a page (a ranked list, the latest plays) is `PageSection`
  (`components/page-section`): the small-capitals heading and its `aria-labelledby`.
- A list of rows, with a rank or a poster in front where it has one, is `Rows`
  (`components/rows`). The rows say what they hold; `Rows` says how they are laid out.
- A name that has a page of its own is a link in `ENTITY_LINK` (`lib/link-style`).
- A chart in a card is `ChartCard` (`components/chart-card`; a chart of a detail page is a section, not a card); an app's own wrapper
  (music's `BreakdownCard`) only decides when it is empty.
- The front page of a media app is `FrontPage` (`components/front-page`): the latest twenty of its log with a link to `/historikk` under them. The way into the app's other pages is the menu every page has (see «App pages»).
- The library (`/bibliotek`) is an optional service: an app lists `library` in
  `features` in `lib/apps.ts` and has the page only then. `scripts/media-apps.test.ts` fails when an app's page files,
  links and browser tests disagree with that list.

A heading, row or link class written out again in an app is a copy; `npm run dupes`
catches some of them, review the rest. A package with components that is not
`packages/ui` has to be scanned by Tailwind through an `@source` in each app's
`index.css`; `scripts/tailwind-sources.test.ts` fails when one is missing.

- The library of a media app (`components/library-page`) is what the owner **has and wants**, with the format it is owned in;
  what was seen, heard or played is the log's and the history's. An app with no collection (podcasts) lists everything it has.

- **No separator dots in an overview** (`·`). Facts about one thing go on a line each (`components/lines`), several things with the
  same facts in the shadcn `Table` (`components/table`: the sources and accounts of `/kilder`, a cast, a person's role), a thing
  with a name and a value in a `dl` or `FactList`, and a gallery tile's `meta` is a list of lines. A running sentence may use commas.

## Times: one component, Norwegian, in Oslo

Every time or day a page shows is written by `formatTime` (`@designsystem/intl/time`) or the `Time` component (`@designsystem/ui/components/time`,
a `<time dateTime>` element around it): «11. november 2026 kl. 07:55», never a raw `2026-11-11T06:55:04.667Z`. Styles: `datetime` (default),
`compact`, `date`, `day`, `weekday`, `weekdayDate`, `clock`; `formatSince` says «for 3 timer siden», `osloDay` gives the Oslo calendar day to group by.
What is no time reads «ukjent tid». `scripts/time-format.test.ts` fails on `Intl.DateTimeFormat`, `toLocale…String`, `toISOString`, `getHours`
and the like outside `packages/intl/src`; its `ALLOWED` list is what was left when the rule came and only shrinks. `.githooks/pre-commit` runs it.

## App pages

Every page of an app gets the same navigation, put there by the page frame and not by the page: `layouts/AppPage.astro` gives `AppLayout` the app's `AppNav` (`components/app-nav`, the design system's `NavBar`: a bar at the foot of the screen on a phone, a rail at the left from tablet width) and puts `AppBreadcrumbs` (the design system's `Breadcrumbs`) over the page. The bar is the app's top-level pages from `APPS` (`lib/apps.ts`, `appTopPages`, at most five), the section the visitor is in marked (`currentSection`, `lib/nav`). A page that has subpages lists them under its title: `PageHeader` (`components/page-header`) does it for a page with `page="<app>:<path>"` (`AppSubPages`, the design system's `SubPages`: an icon, the name and one line, in one column; never cards). A page therefore writes only its header and its content, never a menu. The page of one thing (`thing` on `AppPage`/`FilmPage`/`ShelfPage`) has no sentence about the data, is named in the breadcrumbs and marks the list of things in the bar. A new page of an app is one entry in `APPS`; the bar, the breadcrumbs, the subpage list and the page preview follow. `docs/NAVIGATION.md` has the model.
