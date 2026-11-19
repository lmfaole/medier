/**
 * The table of `db/github.sql` another app reads: the owner's latest commit in
 * a CV project's public repository, written by `apps/work/sync-rust`. `work`
 * joins it to `cv_project`; the test checks the columns against the schema, so
 * a change there fails here first.
 */

import * as v from "valibot"

/** The table as the attached `github` database names it, for a reader whose own database is another one. */
export const GITHUB_PROJECT_COMMITS_TABLE = "github.github_project_commits"

/** One row of `github_project_commits`: fetched without a token, so only a public repository is ever here. */
export const GithubProjectCommitRow = v.object({
  repo: v.string(),
  sha: v.string(),
  message: v.string(),
  committed_at: v.string(),
  url: v.string(),
})
