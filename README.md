# medier

Hva du hører på og ser: en side på Cloudflare Workers, <https://medier.lmfaole.party/>, laget med designsystemet
[`@lmfaole/designsystem`](https://github.com/lmfaole/designsystem).

## How it works

- **Whose data.** The visitor's own: they give their Last.fm and Trakt usernames in a form (the design system's `UsernameForm`, in `src/components/UsernameGate.astro`, posted to `src/pages/api/brukernavn.ts`, no JS needed), which checks each with its
  service (Last.fm's `user.getinfo`; Trakt's profile, which must be public) and keeps it in a cookie for a year (`lastfm_user`, `trakt_user`; path `/`, `SameSite=Lax`, `Secure`, `HttpOnly`). An empty field forgets it.
  Without a username a page shows the form instead of data: Musikk and its pages (its Historikk and Wrapped too) need Last.fm, Film and TV and theirs Trakt, and the front page shows what has a username and asks for the rest.
  «Viser data for … · Bytt» at the foot of every page leads to Innstillinger (`/brukernavn/` is a redirect there now).
- **The first run.** A first visit opens a full-screen wizard over whatever page it landed on (the design system's `FirstRun`, in `src/components/FirstRunWizard.astro` and `src/components/settings-fields.tsx`):
  welcome · Last.fm · Trakt · the front page's sections · theme · effects · tilt · install, one question a step. The effects and the tilt are chosen by their live examples
  (`ChoiceCards` with `EffectsPreview`/`TiltPreview` as the cards, one island each, `src/components/effect-choices.tsx`). It is drawn open by the server (no flash) until `first-run@1` is in `seen`, and works without JS
  as one form; with JS (`FirstRunEnhancer`) it is one step at a time, and a username is checked as the step is left (`validate=<step>`, answered with `{ errors }`). It posts to
  `src/pages/api/innstillinger.ts`, which keeps the usernames (as `/api/brukernavn/` does), the choices in the design system's `prefs` cookie (theme, effects, tilt, sections; not `HttpOnly`) and marks it seen.
  A username not found sends back to its step (`?forste-gang=<step>` with the error); «Hopp over» (`skip=1`) only marks it seen. It is never drawn on Innstillinger or `/offline/`, and the intros wait until it is done.
- **Innstillinger** (`/innstillinger/`, in the footer) has the same fields in sections and one «Lagre» to the same endpoint, and «Vis introen igjen» (`rerun=1`), which takes the wizard out of `seen`.
  The root layout spreads `htmlAttributes(prefs)` on `<html>` (`data-theme`, `data-effects`, `data-tilt`), and the front page shows only the sections chosen (all until some are; none says so).
- **The first visit.** Musikk, Film, TV and the Historikk of each have a short intro (`IntroCallout`, the texts in `src/lib/onboarding.ts`), and the front page offers to install the app (`InstallPrompt`). What has been dismissed is kept in the design system's `seen` cookie
  (path `/`), read by the server so nothing flashes; an intro is never shown where the page shows the username form instead. An empty list says why and what to do about it (`EmptyState` with one action). Only public data is shown: the site's keys are used, never a sign-in of the visitor's. The Worker has no username of its own.
  Every page is `Cache-Control: private` with `Vary: Cookie` (`src/middleware.ts`), the Worker's cache is keyed by the address (which has the username in it), and the service worker keeps one visitor's pages at a time.
- A page asks its sources when it is asked for: Last.fm (plays and what plays now), Trakt (viewings), TMDB (posters) and Spotify (artists' pictures and links, found by name). Each answer is kept in the Worker's cache for a short while
  (`TTL` in `src/lib/sources.ts`: 15 s for what plays now, a minute for the plays, five minutes for the viewings, a month for a poster), so a page is quick and the sources are asked little.
  A source that is down, or not set up, leaves its part out; the rest of the page shows.
- **Pictures and a little more.** An artist's page has its picture and a link to it from Spotify (found by searching the name, and only used where an artist is named exactly the same: a wrong
  picture is worse than none), the tags, the listeners and the start of the text from Last.fm, and the top-artist lists have the pictures too. A film's or a show's page has the plot (in
  Norwegian where TMDB has it), genres, length or seasons and TMDB's vote, from the same answer as the poster. An album and a track have pages too, `/musikk/album/<artist>--<album>/` and `/musikk/spor/<artist>--<track>/`, for what is among the recent plays (like an artist): the artist, the album or the track, how long it is, the tags,
  how many listen and how many times it has been played in all (Last.fm), the tracks of an album in order (those that have been played link to their page), and from Spotify, found by name and artist, the day it came out, the
  number of tracks and the link (with Spotify's mark where its day and count are shown). Every song in a list links to its page and its album to the album's. A title's page also names who played in it (the first twelve, each with the part) and who made it (directing, writing, music, photography, and for a show who created it), from the same TMDB answer
  (`append_to_response=credits`); each person has a page of their own, `/personer/<TMDB id>-<name>/`, with their picture, dates and life story from TMDB (in Norwegian where TMDB has it) and the films and
  shows seen that they are named in. A person has a page only while a title seen names them. Spotify content is attributed to Spotify (their mark, 28 px, one colour) and
  links back to it; TMDB's statement is at the foot of every page. Everything is kept for a day at most (a poster and a title's facts for a month) and nothing is stored.
- There is no database and nothing is committed as data. `src/lib/` reads the APIs' answers (pure, with tests); `src/components/` and `src/pages/` show them.
- A Worker on the lmfaole.party zone cannot reach origins outside Cloudflare (every such fetch ends in 525), so the site asks through a small relay, `upstream/` (`medier-upstream` on
  workers.dev): only those four hosts, only GET (and Spotify's token), only with a key the site and the relay share.
- What plays now is Last.fm's «now playing» (a scrobble of whatever plays) for the visitor's username; Spotify's «currently playing» is not used (it could only be the owner's).

## Music and film, apart

Music (Last.fm), films and TV (both Trakt: the films, and the shows' episodes) are kept apart: each has its overview, its own Historikk and its own Wrapped, under its own address (`src/lib/media.ts`), reached from the overview's cards (`SubPages`), never from the bar.

| | Musikk | Film | TV |
| --- | --- | --- | --- |
| Overview | `/musikk/` | `/film/` | `/tv/` |
| A page of one | `/musikk/<artist>/` (and `album/`, `spor/`) | `/film/<slug>/` | `/tv/<slug>/` (a show) |
| History | `/musikk/historikk/` | `/film/historikk/` | `/tv/historikk/` |
| Week | `/musikk/uke/<year>-<week>/` | `/film/uke/<year>-<week>/` | `/tv/uke/<year>-<week>/` |
| Month | `/musikk/maned/<year>-<month>/` | `/film/maned/<year>-<month>/` | `/tv/maned/<year>-<month>/` |

`/<medium>/uke/` and `/<medium>/maned/` open the last week or month that is over. Old addresses are moved for good (301) in one step, with the week or month and the query kept: `/historikk/`, `/uke/…` and `/maned/…` to the music's, and `/film-og-tv/` with its `historikk/`, `uke/…` and `maned/…` to the film's (`oldAddress`, by `src/middleware.ts`). An old page of a title, `/film-og-tv/<slug>/`, goes to `/film/<slug>/` or `/tv/<slug>/` by whether the visitor's history has it as a film or a show (a «-film» or «-serie» after the slug, from when the two shared a place, is read too), else to the film's (`src/pages/film-og-tv/[slug].astro`).
A page of music needs only the Last.fm username and asks only Last.fm; one of film or TV only the Trakt username, and a wrapped asks Trakt only for the films or only for the episodes (`loadPeriod(…, medium)`). A person's page (`/personer/…`) is under Film or TV by what they were in first.
The front page has a section for each (`film`, `tv`); a `prefs` cookie from before, with `film-og-tv` among its sections, shows both (`shownSections`).

## History

The Historikk of each medium has its plays, its films or its episodes on a timeline (the design system's `Timeline`), newest first under a heading for each day, with a run of one album's songs or one show's episodes folded away («Vis 9 spor til»), and, for music, the song playing now first, marked as going on. A song links to its page here, a viewing to the film's or the show's. Above it are the **sessions** of the last two days (`DurationBars`): plays or viewings less than 30 minutes apart are one session, a song counted at a typical 3½ minutes and a viewing at its film's runtime (or 45 minutes for an episode, 110 for a film TMDB has none for), up to when Trakt marked it seen. It is made of what the front page already asks for (the last 50 plays or viewings), by `src/lib/timeline.ts`. The front page's Musikk, Film and TV link to their own.

## The sleeve of an album

On the page of an album the cover is a **sleeve in 3D** (`Head` with `sleeve`, the design system's `AlbumSleeve`): the cover whole on a slab of plastic with a record half out of it, the label in the cover's most vivid colour, tilting toward the page's light (the pointer, a phone's tilt) and catching it. It adds a record and a gleam to the cover, so it is only for **Last.fm's** covers: the album pages use Last.fm's, and a Spotify cover is never made a sleeve or a disc. Before WebGL is ready, where it is not there and under reduced motion it is the cover alone, as a sharp square, in the same place.

## The albums of an artist

The page of an artist lists its most played albums (`artist.gettopalbums`, one call kept a day, `loadArtist`): ranked by Last.fm's plays with the design system's `RankedRows`, with Last.fm's covers, nameless and repeated albums left out, up to eight. An album the owner has played lately links to its page here and says so.

## Weekly and monthly wrapped

The head of a week's or a month's page is the same composed head as a detail page's (`Head`, the page `bare`): the most played album of the stretch leads it, its cover as the picture and its colours as the stage (WebGL, moving with the light), with the stretch and the album named under the title. The front page's card of what plays now stands on a stage of the cover's colours too, and when the song changes the colours go over to the new cover's in one move.

**Wrapped** (the card on Musikk) opens the last week that is over, `/musikk/uke/<year>-<week>/` (ISO weeks, Monday to Sunday in Oslo time, `src/lib/weeks.ts`); this week so far and the twelve before it are listed on the page.
Only numbers and lists: **Tall** (plays, how many different artists and songs, listening time, the busiest day and hour, the shape of the days), **top artists, albums and songs** in the shapes of what they are, with how each artist's place
moved since the week before, and **new artists** (those among the ten most played that had no plays at all before the week).
**The Wrapped of film** (`/film/uke/…`, `/film/maned/…`, `FilmPeriod` in `src/components/wrapped.tsx`) has the same head (the latest film's poster), the films, the time watched (a guess: the runtime, 110 minutes where TMDB has none), the busiest day and the shape of the week (a month: films per day), the films, and the genres and directors most watched (TMDB's, where it has been asked for the film).
**The Wrapped of TV** (`/tv/uke/…`, `/tv/maned/…`, `TvPeriod`) has the most watched show's poster as its head, the episodes, different shows, days of binges, the time watched (45 minutes an episode), the busiest day and the shape of the week (a month: episodes per day), the shows most watched, and runs of three episodes or more of one show on a day.

**The month** is the same, `/musikk/maned/<year>-<month>/` (calendar months in Oslo time, `src/lib/months.ts`), reached from the wrapped of a week by the chips Uke and Måned, with this month so far and the twelve before it listed on its page. It has the same numbers and
lists, the change is from the month before, up to 2 800 plays are read (14 pages) and Trakt's history up to three pages of a hundred for films and for episodes. Both are made by one loader (`loadPeriod` in `week-source.ts`) over any range of time.
**Charts of change over time** (`src/components/trend.tsx`, the trend as a server island that asks for its own page, so it has a budget of questions of its own, the design system's column chart, drawn in the browser): the page of a week shows plays per week for the twelve weeks up to it, and the page of a month shows plays per month for the twelve months up to it and plays per day in the month.
The totals cost one small question to Last.fm each (a page of one play, whose `total` is the count, `loadTrend`), kept a day once the period is over; a period that could not be told is a gap, never a zero. The days come from plays already read.
**The light** follows the rules of the design system's «Foundations / Light and shadow»: the main picture of a page, and only it, is lit. On a page of a thing (artist, album, song, film or show, person) that is its `Picture size="hero"`, lit on its **frame** (a shadow away from the light and a rim towards it, outside the picture, so nothing is painted over Spotify's artist pictures); the page's head is the design system's `DetailHeader` as an island (`<Head client:idle … />`, `src/components/head.tsx`; the detail components are not hydrated, so the backdrop and the light need it): the picture and the name together, the picture beside the name on a phone, on four colours taken from the picture (never the picture) drawn in WebGL, moving with the light and drawn only when it changes. It is the page's `<h1>`, so the page is `bare` (`Page.astro`), and `src/pages/head.test.ts` fails on a page of a detail component without it. The head's text is the full text colour, never muted: the ground is tinted. The record on the front page is the one thing lit on its **surface**, and only with Last.fm's cover. A reader is asked to let the light follow the phone once, and the answer is kept in the browser.

What is playing now is the card at the top of the front page (`NowPlayingSection`, the design system's `NowPlayingCard`): a disc drawn in WebGL, a real 3D object (a thickness with an edge and a deep hole, a studio reflected in its lacquer, the grooves' spectrum in bands that move with the light and the angle), that turns slowly under the page's one light, which follows the pointer and, on a phone, how it is held (the design system's `LightSource`; iOS asks first), with «● Spilles nå»; a tap on the disc pauses it. The disc is made of Last.fm's cover (`Playing.disc`).
The card **keeps up**: while the front page is open and visible it asks `/api/now/` (`src/pages/api/now.ts`, Last.fm's song for the username in the visitor's cookie, kept fifteen seconds in the Worker's cache, `private` to the browser) every fifteen seconds, and a new song changes it; nothing is asked while the tab is hidden, and the card goes only after two empty answers in a row. It sits in the design system's `LiveRegion`, so a screen reader is told of a new song. The disc's reflections are shaped by the cover (its hue, vividness and lightness), so no two covers shine alike.
There are no notifications: the site is public, so there is nobody to notify but whoever happens to open it.

Nothing is stored: every week is made when it is asked for, from Last.fm (`user.getrecenttracks` with the week's range, read page by page up to 1 600 plays; the week before's `getweeklyartistchart`; the chart of everything before the
week, from the beginning of time to its start, for who is new; `track.getinfo` for the length of a sample of the most played songs) and Trakt (the history in the range), and kept for a day when the week is over and for five minutes when
it is not. A page may ask a Worker's limit of questions, so the lengths of songs come in turns (at most 10 new questions on a page, the most played first; what is kept is free) and fill in over the next visits, a few at a time because
Last.fm answers a rate limit as an error. An artist is new when it is not on the chart of everything before the week; Last.fm cuts that chart at a thousand artists, and then what is not on it is asked about by the owner's total for it,
less the plays in the week and after it (`user.getartisttracks`, which would say it directly, is gone from Last.fm). The listening time is an **estimate**: the known lengths, and the plays whose length is not known counted at their average
(a typical 3½ minutes where none is known), with how many of the plays the length is known of. No Spotify data is in it except the pictures of the artists. `src/lib/wrapped.ts` makes the numbers, `src/lib/week-source.ts` fetches what they
are made of; both are tested.

**Last.fm's errors are never kept.** Last.fm answers an error («Rate Limit Exceeded», «Deprecated») with HTTP 200, so a cache that trusts the status kept them for as long as it kept an answer, and a song's length stayed unknown for a week.
`lastfmError` (`sources.ts`) names them; `runtime.ts` refuses to keep one and asks again where one was kept before.

## Installed app (PWA)

The site installs on a phone or a computer and opens without the browser around it: «Legg til på Hjem-skjerm» on iOS, the install offer in the address bar on Android and desktop Chrome (there is no install button
of our own). `public/manifest.webmanifest` is the identity (`id` and scope `/`, never changed once installed; dark colours, `any` and `maskable` icons at 192 and 512 drawn by `node scripts/icons.mjs`), and
`public/sw.js` the service worker: a page from the network first with the last copy of each page when there is no network (the forty last, kept by address with the query, and only the current visitor's: a page for other usernames or other `prefs` or with the wizard open or closed, by the server's `X-Medier-Who`, drops the ones before), the front page and then `/offline/` when there
is none; the built files and icons from the cache. Nothing from another site is kept (the covers are Spotify's, Last.fm's and TMDB's own), a redirect or an error is never kept as a page, and a new version waits until the
app is closed (no `skipWaiting`) and then deletes the old caches: change `VERSION` in `sw.js` to make it. A bar at the foot on a phone, a rail from tablet width, goes between Forside, Musikk, Film and TV;
`ConnectionBanner` says so when the device is offline and the page is the last one fetched. `src/pwa.test.ts` pins the manifest and runs the worker against a cache and a network of its own.

## Shape language

A picture's shape tells what kind of thing it is of, the same in a list and on the thing's own page (`src/lib/shapes.ts`, pinned by a test that no two kinds share one): **a circle** is a person or a band (artists, cast and crew), **a
tall frame** is a film or a show, **a square with sharp corners** is a record (an album's cover), **a square tile with soft corners** is a single song. Spotify's own covers keep the small corners its guidelines ask of cover art, whatever the
row. The artists' pictures are Spotify's and are cropped to the circle, which its terms probably do not allow: change `SHAPES.artist` to `album`'s shape in one line if that is a risk not worth taking.

## Set up once

1. **Cloudflare.** A Cloudflare API token that may edit Workers, and the account id, as GitHub Actions secrets of this repository: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
   (Settings → Secrets and variables → Actions). A push to `main` then deploys the relay and the site (`.github/workflows/site.yml`).
2. **The address.** `medier.lmfaole.party` is the Worker's custom domain (`wrangler.jsonc`). Cloudflare makes its DNS record when the site is deployed, so the old record that pointed it at GitHub Pages
   (a CNAME to `lmfaole.github.io`) must be gone first, and the custom domain under Settings → Pages removed.
3. **Spotify, once.** The redirect address must be a loopback one registered in the Spotify dashboard (the monorepo's `SPOTIFY_REDIRECT_URI` is):

   ```sh
   npm run spotify:auth -- ~/Applikasjoner/Documents/monorepo/secrets/music-sync.env   # approve in the browser; writes .spotify.env (not committed)
   ```

   The token it makes lasts six months; run it again then (the page just shows no song when it has run out).
4. **The Worker's settings**, from the env files the private monorepo already has, after the first deploy (a Worker has secrets only once it exists). Only the names in `src/lib/settings.ts` are taken;
   each value goes to `wrangler` or `gh` on stdin and is never printed. `UPSTREAM_URL` is the relay's address on your workers.dev account, `https://medier-upstream.<subdomain>.workers.dev`: put it in
   a file of your own (`UPSTREAM_URL=…`), and the key the two share is made if it is not in the files:

   ```sh
   npm run settings:push -- ~/Applikasjoner/Documents/monorepo/secrets/music-sync.env ~/Applikasjoner/Documents/monorepo/secrets/film-sync.env .spotify.env relay.env
   ```

   `-- … --dry-run` says what it would set. Signed in to Cloudflare with `CLOUDFLARE_API_TOKEN` in the environment, or `npx wrangler login`.

## Made-up data (no keys, no network)

`MOCK_DATA=1` in `.dev.vars` (see `.dev.vars.example`; it is a local setting, never one of `settings.ts`'s and never pushed) answers every source from `src/lib/mock.ts` instead of fetching: Last.fm, Trakt, TMDB and Spotify,
shaped as the real ones are (any username is taken, and all get the same data), from **real metadata**: albums, tracklists, films, shows and people in `src/lib/mock-data.json` (committed), with plays and viewings laid out relative to now, so every recent week and month has some and a couple of artists are new.
It sits in `ask()` in `runtime.ts`, so the loaders and parsers run as they do for real; made-up answers are cached under their own keys. Unset, nothing changes. Restart `npm run dev` after changing `.dev.vars`.

The JSON and the pictures in `public/mock/` were fetched once by `node scripts/fetch-mock-data.mjs` from Deezer (albums, covers, artist pictures) and Wikipedia and Wikidata (texts, posters, portraits, dates); the texts are Wikipedia's (CC BY-SA).
**The pictures are third-party artwork for local development only**: `public/mock/` is in `.gitignore`, so they are not committed (or deployed from a clean checkout), and `node scripts/fetch-mock-data.mjs --images` fetches the missing ones again from the addresses in the JSON. The same script without `--images` rewrites the JSON.

## Work on it

```sh
npm install
npm test && npm run typecheck   # the parsers', the loaders' and the relay's tests, and the types
npm run dev                      # http://localhost:4321/ (keys in a .dev.vars file, not committed: LASTFM_API_KEY=… and so on; a source without its key is left out)
npm run preview                  # the built Worker as it runs on Cloudflare
npm run deploy                   # from here, instead of from the workflow
npm run ds:bump                  # a newer design system and its skills
```
