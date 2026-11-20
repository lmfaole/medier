# medier

Hva jeg hører på og ser: en statisk side på GitHub Pages, <https://medier.lmfaole.party/>, laget med designsystemet
[`@lmfaole/designsystem`](https://github.com/lmfaole/designsystem).

## How it works

- `.github/workflows/site.yml` runs every three hours: `npm run fetch` asks Last.fm and Trakt for the latest plays and viewings, writes
  `data/music.json` and `data/watched.json`, commits them when they changed, builds the site with Astro and publishes it on Pages.
- There is no server, no database and no machine of mine in it: the data is the JSON in `data/`, the pages are HTML made at build time.
- `src/lib/` reads the APIs' answers (pure, with tests), `src/components/` and `src/pages/` show them.

## Set up once

The keys live in GitHub, as Actions **secrets** of this repository, and the user names as **variables**; nothing of them is in a file here.
The list is `src/lib/settings.ts`; the workflow checks it before every fetch (`npm run settings:check`) and fails naming what is missing.

1. Settings → Pages → Source: **GitHub Actions**.
2. Put the settings in GitHub, from the env files the private monorepo already has (only the names in the list are taken; values go to `gh` on
   stdin and are never printed):

   ```sh
   npm run settings:push -- ~/Applikasjoner/Documents/monorepo/secrets/music-sync.env ~/Applikasjoner/Documents/monorepo/secrets/film-sync.env
   ```

   `-- … --dry-run` says what it would set. It needs the GitHub CLI signed in with admin rights to this repository. By hand instead: Settings →
   Secrets and variables → Actions, secrets `LASTFM_API_KEY` and `TRAKT_CLIENT_ID`, variables `LASTFM_USER` and `TRAKT_USER`.
3. Actions → Site → Run workflow, for the first fetch.

## Work on it

```sh
npm install
npm test && npm run typecheck   # the parsers' tests and the types
LASTFM_API_KEY=… TRAKT_CLIENT_ID=… npm run fetch   # fresh data locally (a key not set is skipped here, an error in CI)
npm run dev                      # http://localhost:4321/
npm run ds:bump                  # a newer design system and its skills
```
