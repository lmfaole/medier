# Navigation

How a person moves between and within the apps, on a phone and on a desktop. **One model for every app.** The rules are the design
system's («Pages and navigation» in its README and in Storybook, and the `designsystem-ux` skill, installed under `.claude/skills/`);
this file says how this repository puts them into practice. An app only says which pages it has.

## The model

Under the hub there are three levels: **the app's front page → a page → a subpage or the page of one thing.**

| Where | What | Drawn by |
| --- | --- | --- |
| An app's top-level pages (the front page, the history, the library …) | A **bar at the foot of the screen on a phone** and a **rail at the left from tablet width** | `AppNav` (`NavBar` of the design system) |
| Every page of an app | **Breadcrumbs** at the top: the group (`Medier`, for a media app), the app, the page a subpage is under, the page itself. On a phone only the parent, as a way back | `AppBreadcrumbs` (`Breadcrumbs`) |
| A page that has subpages | The subpages **under its title**, as a list in one column: an icon, the name, one line of what is on each | `PageHeader` → `AppSubPages` (`SubPages`) |
| The page of one thing (an artist, a film) | Breadcrumbs through the list of things (the library, else the front page); that list is marked in the bar | `thing` on `AppPage` |
| Moving between apps | A media app: the first crumb, `Medier`, is the hub, which lists the apps. A home app: its front page lists the other home apps and the hub | `AppSwitcher` |

There is no side menu, no cards for pages and no tabs (tabs switch views of one page; this goes to other pages).

## Rules

1. **One registry.** Add an app or a page in `packages/ui/src/lib/apps.ts`, nowhere else. A page has `to`, `label`, `icon` (a meaning of the
   design system's `ICONS`, not a glyph), `description` (what is on the page, one line) and, for a subpage, `under` (the path of the page above).
   The bar, the breadcrumbs, the list of subpages and the page preview all read it. No app draws its own `<nav>` or menu.
2. **At most five top-level pages per app** (a page without `under`): they must fit under an icon on a phone. A sixth is a subpage of one of
   them (`lib/nav.test.ts` fails on a sixth).
3. **Labels are one word** where they can be: they stand under an icon.
4. **The breadcrumbs say where, the title says what.** A page never repeats its title in a second heading to say where it is.
5. **What stops something comes first.** A page that has an alert shows it directly under the title, then the subpages (`PageHeader
   subpages={false}`, then `<AppSubPages>` lower), then the content.
6. **Apps are separate apps in one server.** A link to another app is a plain `<a>` to its own origin (`appOrigin`), a full page load; only the
   current app's links are client-side. Say so before promising that navigation is instant.
7. **A page is a full load.** The browser resets focus and scroll itself, so nothing moves focus after a navigation, and a «Skip to content»
   link leads to `#main-content`. A new page keeps one `<h1>`.
8. **The change of page is the browser's own cross-fade, nothing more** (`shell.css`: `@view-transition { navigation: auto }`, off under
   `prefers-reduced-motion`).
9. **Reachable and marked.** Every entry is a target at least 40 px high; the page you are in carries `aria-current="page"`.
10. **One reading direction: down.** A page is one column in the reading column; the bar and the rail are chrome, not content.

## Adding an app or a page

- **A page:** add `{ to, label, icon, description }` to the app's `pages`. It becomes a place in the bar (a page without `under`) and is
  listed by its parent (a page with it). `og-pages.json` needs a row for it (`og-pages.test.ts` fails without one; run
  `npm run generate --workspace @designsystem/content`).
- **A subpage:** give the page `under: "<path of the page above>"`. The page above lists it (`PageHeader` does it by itself for a page that
  uses `page="<app>:<path>"`; a page with its own title passes `page=` too), and the breadcrumbs go through it (music's `/tilbakeblikk/uke` is
  Medier, Musikk, Tilbakeblikk, Uke for uke).
- **An app:** an entry in `APPS` or `HOME_APPS`, its `group`, and a page for each feature it switches on.
