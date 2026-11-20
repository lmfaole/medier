# medier

Hva jeg hører på og ser: en side på Cloudflare Workers, <https://medier.lmfaole.party/>, laget med designsystemet
[`@lmfaole/designsystem`](https://github.com/lmfaole/designsystem).

## How it works

- A page asks its sources when it is asked for: Last.fm (plays), Trakt (viewings), TMDB (posters) and Spotify (what plays now). Each answer is kept in the Worker's cache for a short while
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
- Spotify asks one permission, to see what plays (`user-read-currently-playing`). The song shows first on the front page and on Musikk, marked «nå». Where Spotify is not set up, Last.fm's
  own «now playing» (a scrobble of the same song) is shown instead.

## Weekly wrapped

The place **Uke** in the bar opens the last week that is over, `/uke/<year>-<week>/` (ISO weeks, Monday to Sunday in Oslo time, `src/lib/weeks.ts`); this week so far and the twelve before it are listed on the page.
Only numbers and lists: **Tall** (plays, how many different artists and songs, listening time, the busiest day and hour, the shape of the days), **top artists, albums and songs** in the shapes of what they are, with how each artist's place
moved since the week before, **new artists** (those among the ten most played that had no plays at all before the week) and **film og TV** (films, episodes, the shows most watched, and runs of three episodes or more of one show on a day).

Nothing is stored: every week is made when it is asked for, from Last.fm (`user.getrecenttracks` with the week's range, read page by page up to 1 600 plays; the week before's `getweeklyartistchart`; `getartisttracks` before the
week for who is new; `track.getinfo` for the length of the most played songs) and Trakt (the history in the range), and kept for a day when the week is over and for five minutes when it is not. A page may ask a Worker's limit of
questions, so the lengths of songs and the new artists come in turns (at most 10 and 8 new questions on a page, the most played first, what is kept is free) and fill in over the next visits. The listening time is an **estimate**: the known lengths,
and the plays whose length is not known counted at their average (a typical 3½ minutes where none is known), with how many of the plays the length is known of. No Spotify data is in it except the pictures of the artists. `src/lib/wrapped.ts`
makes the numbers, `src/lib/week-source.ts` fetches what they are made of; both are tested.

## Installed app (PWA)

The site installs on a phone or a computer and opens without the browser around it: «Legg til på Hjem-skjerm» on iOS, the install offer in the address bar on Android and desktop Chrome (there is no install button
of our own). `public/manifest.webmanifest` is the identity (`id` and scope `/`, never changed once installed; dark colours, `any` and `maskable` icons at 192 and 512 drawn by `node scripts/icons.mjs`), and
`public/sw.js` the service worker: a page from the network first with the last copy of each page when there is no network (the forty last, kept by address with the query), the front page and then `/offline/` when there
is none; the built files and icons from the cache. Nothing from another site is kept (the covers are Spotify's, Last.fm's and TMDB's own), a redirect or an error is never kept as a page, and a new version waits until the
app is closed (no `skipWaiting`) and then deletes the old caches: change `VERSION` in `sw.js` to make it. A bar at the foot on a phone, a rail from tablet width, goes between Forside, Musikk and Film;
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

## Work on it

```sh
npm install
npm test && npm run typecheck   # the parsers', the loaders' and the relay's tests, and the types
npm run dev                      # http://localhost:4321/ (keys in a .dev.vars file, not committed: LASTFM_API_KEY=… and so on; a source without its key is left out)
npm run preview                  # the built Worker as it runs on Cloudflare
npm run deploy                   # from here, instead of from the workflow
npm run ds:bump                  # a newer design system and its skills
```
