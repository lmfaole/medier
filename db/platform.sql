-- Schema of `.data/platform.db`: when each data tool last ran (`scripts/sync-timers.ts`). Every statement is idempotent: the tools apply it on every
-- run (`include_str!`), `npm run snapshot` applies it, and the tests build their SQLite from it.
-- A changed or dropped column is a numbered migration in `db/migrations/platform/` (`docs/DATA.md`).

-- =============================================================================
-- platform: when each data tool last ran. Written by `scripts/sync-timers.ts` only.
-- =============================================================================
-- One row per job run on a timer. `finished_at` stays NULL until the job ends,
-- so a run that died (power loss, kill) shows as unfinished, not as ok.
-- `error` is only the exit status, never the job's output, which can carry a token.
CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL, -- the app whose tool ran, e.g. music
  job TEXT NOT NULL, -- the job line, e.g. "summaries current-year"
  started_at TEXT NOT NULL, -- ISO 8601, UTC
  finished_at TEXT, -- ISO 8601, UTC; NULL while running or if it died
  ok INTEGER NOT NULL DEFAULT 0, -- 1 only when the job exited 0
  error TEXT,
  added INTEGER -- rows the whole run added to the app's main table; set on its last job, and only when every job exited 0
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_source_job ON sync_runs (source, job, started_at);
