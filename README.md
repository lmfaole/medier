# medier

Hva jeg hører på og ser: en side på Cloudflare Workers, <https://medier.lmfaole.party/>, laget med designsystemet
[`@lmfaole/designsystem`](https://github.com/lmfaole/designsystem).

## How it works

- A page asks its sources when it is asked for: Last.fm (plays), Trakt (viewings), TMDB (posters) and Spotify (what plays now). Each answer is kept in the Worker's cache for a short while
  (`TTL` in `src/lib/sources.ts`: 15 s for what plays now, a minute for the plays, five minutes for the viewings, a month for a poster), so a page is quick and the sources are asked little.
  A source that is down, or not set up, leaves its part out; the rest of the page shows.
- **Pictures and a little more.** An artist's page has its picture and a link to it from Spotify (found by searching the name, and only used where an artist is named exactly the same: a wrong
  picture is worse than none), the tags, the listeners and the start of the text from Last.fm, and the top-artist lists have the pictures too. A film's or a show's page has the plot (in
  Norwegian where TMDB has it), genres, length or seasons and TMDB's vote, from the same answer as the poster. A title's page also names who played in it (the first twelve, each with the part) and who made it (directing, writing, music, photography, and for a show who created it), from the same TMDB answer
  (`append_to_response=credits`); each person has a page of their own, `/personer/<TMDB id>-<name>/`, with their picture, dates and life story from TMDB (in Norwegian where TMDB has it) and the films and
  shows seen that they are named in. A person has a page only while a title seen names them. Spotify content is attributed to Spotify (their mark, 28 px, one colour) and
  links back to it; TMDB's statement is at the foot of every page. Everything is kept for a day at most (a poster and a title's facts for a month) and nothing is stored.
- There is no database and nothing is committed as data. `src/lib/` reads the APIs' answers (pure, with tests); `src/components/` and `src/pages/` show them.
- A Worker on the lmfaole.party zone cannot reach origins outside Cloudflare (every such fetch ends in 525), so the site asks through a small relay, `upstream/` (`medier-upstream` on
  workers.dev): only those four hosts, only GET (and Spotify's token), only with a key the site and the relay share.
- Spotify asks one permission, to see what plays (`user-read-currently-playing`). The song shows first on the front page and on Musikk, marked «nå». Where Spotify is not set up, Last.fm's
  own «now playing» (a scrobble of the same song) is shown instead.

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
