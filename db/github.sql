-- Schema of `.data/github.db`: the owner's repositories, pull requests, issues and contribution days (`apps/work/sync-rust`). Every statement is idempotent: the tools apply it on every
-- run (`include_str!`), `npm run snapshot` applies it, and the tests build their SQLite from it.
-- A changed or dropped column is a numbered migration in `db/migrations/github/` (`docs/DATA.md`).

-- =============================================================================
-- github: the owner's repositories, pull requests, issues and contribution days.
-- Written by `apps/work/sync-rust` only. Private repositories are in here, so
-- none of it is ever in a snapshot or an API file that is. GitHub keeps all of it, so
-- every run replaces a table with what GitHub says now.
-- =============================================================================
CREATE TABLE IF NOT EXISTS github_repos (
  full_name TEXT PRIMARY KEY, -- owner/name
  private INTEGER NOT NULL,
  fork INTEGER NOT NULL,
  archived INTEGER NOT NULL,
  created_at TEXT NOT NULL, -- ISO 8601, UTC
  pushed_at TEXT,
  language TEXT,
  stars INTEGER NOT NULL,
  description TEXT
);

-- Pull requests and issues the owner opened, in any repository they can see.
CREATE TABLE IF NOT EXISTS github_items (
  id INTEGER PRIMARY KEY, -- GitHub's own id
  kind TEXT NOT NULL CHECK (kind IN ('pr', 'issue')),
  repo TEXT NOT NULL, -- owner/name
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  state TEXT NOT NULL, -- open or closed
  merged INTEGER NOT NULL, -- a pull request that was merged
  created_at TEXT NOT NULL,
  closed_at TEXT,
  url TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_github_items_created ON github_items (created_at);

-- GitHub's contribution calendar: how many contributions a day had. A day with none has no row.
CREATE TABLE IF NOT EXISTS github_days (
  day TEXT PRIMARY KEY, -- YYYY-MM-DD
  contributions INTEGER NOT NULL
);

-- The owner's latest commit in a project's public repository (`cv_project.repo`), fetched without a
-- token so a private repository can never be here: `work` shows a repository only with a row of this table.
-- Written by `apps/work/sync-rust`; a repository with no commit by the owner has no row.
CREATE TABLE IF NOT EXISTS github_project_commits (
  repo TEXT PRIMARY KEY, -- owner/name
  sha TEXT NOT NULL,
  message TEXT NOT NULL, -- the first line only
  committed_at TEXT NOT NULL, -- ISO 8601, the author date
  url TEXT NOT NULL
);
