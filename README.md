# medier

Hva jeg hører på og ser: en statisk side på GitHub Pages, <https://lmfaole.github.io/medier/>, laget med designsystemet
[`@lmfaole/designsystem`](https://github.com/lmfaole/designsystem).

## How it works

- `.github/workflows/site.yml` runs every three hours: `npm run fetch` asks Last.fm and Trakt for the latest plays and viewings, writes
  `data/music.json` and `data/watched.json`, commits them when they changed, builds the site with Astro and publishes it on Pages.
- There is no server, no database and no machine of mine in it: the data is the JSON in `data/`, the pages are HTML made at build time.
- `src/lib/` reads the APIs' answers (pure, with tests), `src/components/` and `src/pages/` show them.

## Set up once

1. Settings → Pages → Source: **GitHub Actions**.
2. Settings → Secrets and variables → Actions:
   - secrets `LASTFM_API_KEY` (<https://www.last.fm/api/account/create>) and `TRAKT_CLIENT_ID` (<https://trakt.tv/oauth/applications>);
   - variables `LASTFM_USER` and `TRAKT_USER` (default `snowpony69` and `lmfaole`). The Trakt profile must be public.
3. Actions → Site → Run workflow, for the first fetch.

## Work on it

```sh
npm install
npm test && npm run typecheck   # the parsers' tests and the types
LASTFM_API_KEY=… TRAKT_CLIENT_ID=… npm run fetch   # fresh data locally
npm run dev                      # http://localhost:4321/medier/
npm run ds:bump                  # a newer design system and its skills
```
