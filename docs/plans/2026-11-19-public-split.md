# The public split

Decided 2026-11-19: media consumption is not private, so everything that is public moves to a public repository, **`lmfaole/medier`**, and is
built and deployed from GitHub Actions. This repository keeps what is private.

## Where the line runs

`scripts/public-split.ts` lists the private side; `public-split.test.ts` fails when a public file imports a private one or opens `secrets/`.
On 2026-11-19 the import graph of the 888 tracked source files split cleanly: 677 public, 211 private, and only three files were private
because of what they import (`audit.ts` and `data-commit.ts` through the timers, and a test that names `secrets/` in a string).

| Public (`lmfaole/medier`) | Private (here) |
| --- | --- |
| music, podkast, film, tv, games, books, boardgames, medier, forside, work, with their `sync-rust` | hjem, penger, innboks, miniflux |
| `packages/*`, `crates/*`, `db/*.sql` and migrations, `e2e/` | `secrets/`, `data-dump/`, `.data/` |
| the media server, build, snapshot, deploy, verify and check scripts | the machine's scripts: timers and units, mail, backup, doctor, notices, data commits |
| `docs/` except the two below | `docs/MACHINE.md`, `docs/HOME-APPS-MIGRATION.md` |

## Steps

1. **Before anything is public**: a secret scan of the public half (done for the tree on 2026-11-19: no keys outside `secrets/`; the
   e-mail in the sync tools' User-Agent is the public one of `forside`), and the docs and `AGENTS.md` rewritten without the private parts.
   The public repository starts with **fresh history**: `secrets/` and `data-dump/` have been in this one's.
2. **The home apps get their own server.** The media server mounts a home app when its `apps/<id>/web/src/server/api.ts` is on disk, so the
   public image runs without them, and this repository runs the same server (pinned from the public one) with only the home apps. The tunnel
   keeps its one rule: the public server answers `/apps/hjemmeserver/<home app>` by proxying to the home container, as it already proxies the
   rest of that prefix to Nextcloud.
3. **The move**: the public half is copied out as it is, with the root `package.json` scripts and workspaces split. This repository then
   depends on `@designsystem/*` from `lmfaole/medier` by commit, as on the design system (a `bump` like `ds:bump`).
4. **Deploy from Actions**: CI (verify) on every push; an image of the media server with the built apps pushed to `ghcr.io/lmfaole/medier`;
   the machine pulls it with `podman auto-update` (`AutoUpdate=registry` in the quadlet of the Nextcloud repository). `forside` and `work` deploy
   to Cloudflare from Actions with an API token in the repository's secrets, from the snapshot the machine publishes.
5. **The data stays on the machine.** The sync tools run here, reading their keys from `~/.config`; the snapshot of `forside` and `work`, and
   for public media pages anything else, is published from the machine.

## Open

- The media pages become public (decided): the login gate of the media apps goes, the home apps keep theirs. The concert photos can show other
  people; they are the one part of the media data that is about someone else.
- How the snapshot reaches Actions for `forside` and `work`: committed to the public repository by the machine's publish timer, or uploaded as a
  release asset. To decide at step 4.
