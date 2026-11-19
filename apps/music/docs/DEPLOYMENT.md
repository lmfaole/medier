# Deployment

## Deploying

1. `npm run sync -- listens` (and the other jobs, `apps/music/AGENTS.md`) fetches
   new listens from ListenBrainz into `.data/data.db`. It needs
   `LISTENBRAINZ_USERNAME` in the environment and nothing from Cloudflare.
2. `npm run deploy` in `apps/music` writes the snapshot of the API from that
   file, builds the app and runs `wrangler deploy`. The Worker and the
   `music.lmfaole.party` custom domain are created by the first deploy; Cloudflare
   Access is set up once in the dashboard (the deploy refuses a config without
   it).

## Keeping the dashboard unlisted

This is personal listening data; nothing here should be findable by anyone
who was not given the URL directly.

- Every response carries `X-Robots-Tag: noindex, nofollow, ...`
  (`@designsystem/config/security-headers`) and the page repeats it as a `<meta>` tag (the shared `Document` layout), so a
  cached or proxied copy of the page still says not to index it.
- `web/public/robots.txt` disallows everything.
- A fixed list of search, social-preview, archive and AI crawlers gets a
  flat 403 (`@designsystem/config/worker-app`), rather than relying on them to respect
  `noindex`.
- `music.lmfaole.party` is never linked from `lmfaole.party` or any other
  public page.

**What this does not hide:** a publicly trusted TLS certificate for
`music.lmfaole.party` is logged in public Certificate Transparency logs the
moment it is issued (`custom_domain = true` in `wrangler.jsonc` requests
exactly such a certificate). Anyone scanning CT logs can learn the subdomain
exists, even though the measures above keep it out of search engines, link
previews and AI crawlers, and the page itself is only useful to someone who
already has the URL. If that is not an acceptable level of obscurity, the
next step up is a Cloudflare Access policy in front of the whole Worker,
which this project does not set up.

## Sync schedule

The sync has two jobs, run by hand (or by the systemd timers in
`sync-rust/schedule.json`): a daily one
(03:17 UTC on a timer) (new listens, their metadata, `daily_plays` for this year, the
all-time listen count, minutes and streaks, this year's summaries, and the rolling windows), a
weekly one on Mondays at 04:47 (`"all"`, and `daily_plays` for the whole history), and
both on manual dispatch, plus `years` to recompute every finished year after
a backfill. ListenBrainz paginates up to 1,000 listens per
request; a gap longer than that between syncs (for one person's listening)
is the only case where a sync would miss something, and it would simply
pick up on the next run from wherever the bookmark
(`sync_state.last_listened_at`) left off.
