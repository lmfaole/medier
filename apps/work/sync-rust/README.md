# work-sync

Keeps the owner's GitHub in the local database (`.data/github.db`): `github_repos`, `github_items` (pull
requests and issues opened) and `github_days` (the contribution calendar). Private repositories are in
it, so **none of it is ever in a snapshot or an API file**; nothing reads it yet.

```sh
cd apps/work
cargo run -p work-sync -- all            # or: repos | items | contributions
```

The token is `GITHUB_TOKEN`, else what `gh auth token` prints (the machine's `gh` is signed in). Search is
one year at a time, 2.2 s apart (GitHub allows thirty a minute), and a table is replaced only when every
year of it came back. The contribution calendar is GitHub's own: it counts what GitHub counts (commits to a
default branch, pull requests and issues it credits), so a year of mostly private pull requests can show
few days there while `github_items` holds them all.

A timer is in `schedule.json` and not installed: a systemd service has no keyring, so it needs the token in
`~/.config/work-sync.env` (`GITHUB_TOKEN=…`, mode 600), then `node scripts/sync-timers.ts work install`.
