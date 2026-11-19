//! The owner's latest commit in each project's public repository, for the CV. The repositories are the
//! `repo` of the CV's projects (`cv.db`). The commit is asked of GitHub's open API **without a token** first,
//! so a private repository answers 404 and gets no row. GitHub's list of commits misses some of an old
//! history, so a repository with none there is asked again through GraphQL with the token, and that answer
//! is used only when it says the repository is not private. Nothing else of the repository is kept.

use std::path::Path;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use serde::Deserialize;
use serde_json::json;
use shared_data::batch::insert_statements;
use shared_data::sqlite_client::SqliteClient;

const API: &str = "https://api.github.com";
const SQL_REPOS: &str = "SELECT DISTINCT repo FROM cv_project WHERE repo IS NOT NULL ORDER BY repo";
const SQL_CLEAR: &str = "DELETE FROM github_project_commits";
const COLUMNS: &[&str] = &["repo", "sha", "message", "committed_at", "url"];

#[derive(Debug, PartialEq, Eq)]
pub struct ProjectCommit {
    pub repo: String,
    pub sha: String,
    pub message: String,
    pub committed_at: String,
    pub url: String,
}

#[derive(Deserialize)]
struct Entry {
    sha: String,
    html_url: String,
    commit: Commit,
}

#[derive(Deserialize)]
struct Commit {
    message: String,
    author: Author,
}

#[derive(Deserialize)]
struct Author {
    date: String,
}

/// The latest commit of an answer to `commits?author=…&per_page=1`: `None` for a repository where the owner
/// has made none (an empty list).
pub fn parse_latest(repo: &str, json: &str) -> Result<Option<ProjectCommit>> {
    let entries: Vec<Entry> = serde_json::from_str(json).context("reading a GitHub commit list")?;
    Ok(entries.into_iter().next().map(|entry| ProjectCommit {
        repo: repo.to_string(),
        sha: entry.sha,
        message: entry.commit.message.lines().next().unwrap_or_default().trim().to_string(),
        committed_at: entry.commit.author.date,
        url: entry.html_url,
    }))
}

#[derive(Deserialize)]
struct GraphqlAnswer {
    data: GraphqlData,
}

#[derive(Deserialize)]
struct GraphqlData {
    repository: Option<GraphqlRepository>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphqlRepository {
    is_private: bool,
    default_branch_ref: Option<GraphqlRef>,
}

#[derive(Deserialize)]
struct GraphqlRef {
    target: GraphqlTarget,
}

#[derive(Deserialize)]
struct GraphqlTarget {
    history: Option<GraphqlHistory>,
}

#[derive(Deserialize)]
struct GraphqlHistory {
    nodes: Vec<GraphqlNode>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphqlNode {
    oid: String,
    committed_date: String,
    message_headline: String,
    url: String,
}

/// The latest commit of a GraphQL answer; `None` for a private repository (never published, whatever it holds),
/// a repository GitHub did not give, or one with no commit by the owner.
pub fn parse_graphql(repo: &str, json: &str) -> Result<Option<ProjectCommit>> {
    let answer: GraphqlAnswer = serde_json::from_str(json).context("reading a GitHub GraphQL answer")?;
    let Some(repository) = answer.data.repository.filter(|repository| !repository.is_private) else {
        return Ok(None);
    };
    let node = repository.default_branch_ref.and_then(|branch| branch.target.history).and_then(|history| history.nodes.into_iter().next());
    Ok(node.map(|node| ProjectCommit { repo: repo.to_string(), sha: node.oid, message: node.message_headline, committed_at: node.committed_date, url: node.url }))
}

#[derive(Deserialize)]
struct UserAnswer {
    data: UserData,
}

#[derive(Deserialize)]
struct UserData {
    user: Option<UserId>,
}

#[derive(Deserialize)]
struct UserId {
    id: String,
}

pub fn parse_user_id(json: &str) -> Result<String> {
    let answer: UserAnswer = serde_json::from_str(json).context("reading a GitHub GraphQL answer")?;
    answer.data.user.map(|user| user.id).context("GitHub has no such user")
}

/// A repository name that is `owner/name` and nothing that could change the request: it goes into a URL.
pub fn is_repo_name(name: &str) -> bool {
    let valid = |part: &str| !part.is_empty() && !part.starts_with('.') && part.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    name.split_once('/').is_some_and(|(owner, repo)| valid(owner) && valid(repo) && !repo.contains('/'))
}

fn fetch(http: &reqwest::blocking::Client, repo: &str, author: &str) -> Result<Option<ProjectCommit>> {
    let url = format!("{API}/repos/{repo}/commits?author={author}&per_page=1");
    let response = http.get(&url).header("Accept", "application/vnd.github+json").send().map_err(reqwest::Error::without_url).context("asking GitHub")?;
    match response.status().as_u16() {
        // Private or gone: the open API cannot see it, so it is not published.
        404 => Ok(None),
        status if status < 300 => parse_latest(repo, &response.text().map_err(reqwest::Error::without_url).context("reading the answer")?),
        status => bail!("GitHub answered {status} for {repo}"),
    }
}

/// The GraphQL asking with the token, for a repository the open list gave nothing for. A refusal (an organisation
/// that wants single sign-on, no token) is not a failure of the run: the repository just has no commit to show.
fn fallback(repo: &str, author: &str) -> Option<ProjectCommit> {
    let (owner, name) = repo.split_once('/')?;
    let answer = crate::client::Client::new().and_then(|client| client.latest_commit(owner, name, author));
    match answer.and_then(|json| parse_graphql(repo, &json)) {
        Ok(commit) => commit,
        Err(error) => {
            println!("{repo}: not asked through GraphQL: {error:#}");
            None
        }
    }
}

pub fn replace_all(db: &SqliteClient, commits: &[ProjectCommit]) -> Result<()> {
    let rows = commits.iter().map(|commit| vec![json!(commit.repo), json!(commit.sha), json!(commit.message), json!(commit.committed_at), json!(commit.url)]);
    let mut batch = vec![(SQL_CLEAR.to_string(), Vec::new())];
    batch.extend(insert_statements("INSERT OR REPLACE INTO", "github_project_commits", COLUMNS, rows));
    db.execute_batch(&batch).context("replacing the project commits")
}

/// The `project-commits` job: for each repository the CV's projects name, the owner's latest commit.
pub fn sync(db: &SqliteClient, cv: &Path, author: &str) -> Result<()> {
    let cv_db = SqliteClient::open(cv).with_context(|| format!("opening {}", cv.display()))?;
    let repos: Vec<String> = cv_db.query(SQL_REPOS, &[])?.iter().filter_map(|row| row["repo"].as_str().map(str::to_string)).collect();
    let http = reqwest::blocking::Client::builder()
        .user_agent("work-sync/0.1 (+https://jobb.lmfaole.party)")
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(60))
        .build()
        .context("building the HTTP client")?;
    let mut found = Vec::new();
    for repo in &repos {
        if !is_repo_name(repo) {
            bail!("{repo:?} is not an owner/name repository");
        }
        let commit = match fetch(&http, repo, author)? {
            Some(commit) => Some(commit),
            None => fallback(repo, author),
        };
        match commit {
            Some(commit) => found.push(commit),
            None => println!("{repo}: no public commit by {author} found"),
        }
    }
    // Replaced only when every repository was asked: a failure part-way must not leave a table of half.
    replace_all(db, &found)?;
    println!("{} of {} project repositories have a commit by {author}", found.len(), repos.len());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn database() -> SqliteClient {
        let db = SqliteClient::open(Path::new(":memory:")).unwrap();
        crate::schema::apply(&db).unwrap();
        db
    }

    #[test]
    fn the_latest_commit_is_its_first_line_its_author_date_and_its_address() {
        let json = r#"[{"sha":"b2b11c1","html_url":"https://github.com/o/r/commit/b2b11c1","commit":{"message":"fix(portal): a\n\nlonger body","author":{"date":"2026-09-24T12:30:38Z"}}}]"#;

        let commit = parse_latest("o/r", json).unwrap().unwrap();

        assert_eq!((commit.message.as_str(), commit.committed_at.as_str(), commit.url.as_str()), ("fix(portal): a", "2026-09-24T12:30:38Z", "https://github.com/o/r/commit/b2b11c1"));
    }

    #[test]
    fn a_graphql_answer_gives_the_commit_but_never_for_a_private_repository() {
        let answer = |private: bool| format!(r#"{{"data":{{"repository":{{"isPrivate":{private},"defaultBranchRef":{{"target":{{"history":{{"totalCount":8,"nodes":[{{"oid":"o1","committedDate":"2022-04-29T11:55:31Z","messageHeadline":"Merge pull request #47","url":"https://github.com/o/r/commit/o1"}}]}}}}}}}}}}}}"#);

        let public = parse_graphql("o/r", &answer(false)).unwrap().unwrap();
        assert_eq!((public.sha.as_str(), public.message.as_str(), public.committed_at.as_str()), ("o1", "Merge pull request #47", "2022-04-29T11:55:31Z"));
        assert_eq!(parse_graphql("o/r", &answer(true)).unwrap(), None);
        assert_eq!(parse_graphql("o/r", r#"{"data":{"repository":null}}"#).unwrap(), None);
    }

    #[test]
    fn a_repository_with_no_commit_by_the_owner_has_none() {
        assert_eq!(parse_latest("o/r", "[]").unwrap(), None);
    }

    #[test]
    fn only_owner_slash_name_goes_into_a_request() {
        assert!(is_repo_name("fremtind/jokul"));
        assert!(!is_repo_name("fremtind"));
        assert!(!is_repo_name("a/b/c"));
        assert!(!is_repo_name("a/b?x=1"));
        assert!(!is_repo_name("../etc"));
    }

    #[test]
    fn replacing_leaves_exactly_what_was_found() {
        let db = database();
        let commit = |repo: &str| ProjectCommit { repo: repo.into(), sha: "s".into(), message: "m".into(), committed_at: "2026-01-01T00:00:00Z".into(), url: "u".into() };
        replace_all(&db, &[commit("a/b"), commit("c/d")]).unwrap();

        replace_all(&db, &[commit("c/d")]).unwrap();

        assert_eq!(db.query("SELECT repo FROM github_project_commits", &[]).unwrap(), vec![json!({"repo": "c/d"})]);
    }
}
