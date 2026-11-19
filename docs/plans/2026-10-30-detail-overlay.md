# Detail from lists as an overlay with its own URL

Status: built and tested in film, tv, games, books, boardgames, music and podkast, 2026-10-30. Approved 2026-10-30 (part 4 of "the services feel more like an app"; parts 1-3 are the overlay primitives,
the period picker and lightbox, and the app menu). First step: film only.

## Intent

Tapping a film, a person or a cinema in a list opens its page over the list instead of leaving it, like a card in an
app. The address bar shows the page's own URL, Back closes the card, and a reload or a shared link gets the full page,
server-rendered as today.

## Mechanism

TanStack Router's route masking. A link navigates to the current page with `state: { detail: { kind, slug } }` and a
`mask` to the detail route (`/film/$slug`), with `unmaskOnReload`. Router keeps the list rendered; the address shows
the detail URL. The history entry is real, so Back closes the card without any hook of ours.

- `lib/detail-state.ts` (`packages/ui`): the `Detail` type, a valibot schema, `detailOf(state)` that reads
  `history.state` through it (never asserted), and the `HistoryState` augmentation.
- `components/detail-host.tsx` (`packages/ui`): `<DetailHost render={(detail) => ReactNode} />`. A `<dialog
  data-overlay="page">`, opened with `showModal()` while `state.detail` is set and closed when it is gone. Esc, the
  backdrop or the close button call `history.back()`. The body is a `page` container so the hero's bleed works.
- `EntityPage` and the watch `EntityView` take an optional `slug` (otherwise from the address, as now). The data is
  read in the browser (`useQuery`), since the list's loader did not prime it; a skeleton shows until it is there.
- `overlay.css`: `data-overlay="page"` is a full-height sheet on a phone and a tall dialog on a desktop.
- `unmaskOnReload` is a router option in this version of Router, not a `Link` prop, so it is set in `createAppRouter`.
- Film: `FilmLink`, `PersonLink` and `CinemaLink` get `state`, `mask`, `unmaskOnReload`; `config.ts` sets
  `overlay` (the field `AppShellConfig` already has) to a host that renders `WATCH.detail`.

## Not in this step

- Prefetching the card's data on hover or focus.
- A compact summary instead of the whole page (chosen: the whole page).

## Test

- `detail-state.test.ts`: `detailOf` accepts a detail and refuses anything else (null, wrong types, extra fields).
- `e2e`: from film's library, a click opens the card, the URL is `/film/<slug>`, the list is still behind it, Back
  closes it and the URL is the list's; loading `/film/<slug>` directly gives the full page and no dialog.
- Browser (phone and desktop): scroll inside the card, Esc, backdrop, axe, console.
