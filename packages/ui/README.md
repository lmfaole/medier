# @designsystem/ui

What the apps share on top of the design system (`@lmfaole/designsystem`, a
repository of its own, `~/Applikasjoner/Documents/designsystem`). Generic UI
lives there and arrives through a tag; this package holds what knows about
these apps.

## What is here

- **Registry and navigation**: `lib/apps.ts` (the apps and their pages), `lib/hub.ts`
  (the media hub), the navigation (`AppNav`: a bar at the foot on a phone, a rail from tablet width), the breadcrumbs (`AppBreadcrumbs`, `lib/breadcrumbs.ts`) and the list of subpages (`AppSubPages`), and the app mark
  and list. The rules are in `docs/NAVIGATION.md`.
- **Layouts and chrome**: `layouts/Document.astro`, `layouts/AppPage.astro`, the
  `AppLayout` and `PageHeader` wrappers around the design system's `PageLayout` and
  `PageHeader`, and the PWA manifest and service-worker registration.
- **Theme**: `src/theme.css` imports the design system's theme and adds one colour per
  app (`--app-*`).
- **Media pages**: the front page, history, library, the entity hero, log tiles and charts, the collection card, the
  og-pages and the glossary.
- **Helpers**: `lib/base-url`, `lib/href`.

A component goes here when it knows about these apps or their data; a generic one
(no app, no data) goes in the design system. See `docs/UI-COMPONENTS.md`.

## Usage from an app

```ts
// Generic building blocks come from the design system, app pieces from here.
import { Button } from '@lmfaole/designsystem/components/button'
import { Stack } from '@lmfaole/designsystem/components/layout'
import { AppLayout } from '@designsystem/ui/components/app-layout'
```

```css
/* src/index.css in the consuming app */
@import "@designsystem/ui/theme.css";
```
