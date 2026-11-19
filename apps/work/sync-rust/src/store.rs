//! Writes what `github.rs` parsed into the local database. GitHub keeps all of it, so a table is
//! replaced by what a run found, and a year of the calendar by that year's days.

use anyhow::{bail, Context, Result};
use serde_json::json;
use shared_data::batch::insert_statements;
use shared_data::sqlite_client::SqliteClient;

use crate::github::{Day, Item, Repo};

const REPO_COLUMNS: &[&str] = &["full_name", "private", "fork", "archived", "created_at", "pushed_at", "language", "stars", "description"];
const ITEM_COLUMNS: &[&str] = &["id", "kind", "repo", "number", "title", "state", "merged", "created_at", "closed_at", "url"];
const SQL_CLEAR_REPOS: &str = "DELETE FROM github_repos";
const SQL_CLEAR_ITEMS: &str = "DELETE FROM github_items";
const SQL_CLEAR_YEAR: &str = "DELETE FROM github_days WHERE day >= ? AND day <= ?";

pub fn replace_repos(db: &SqliteClient, repos: &[Repo]) -> Result<()> {
    let rows = repos.iter().map(|repo| {
        vec![json!(repo.full_name), json!(repo.private), json!(repo.fork), json!(repo.archived), json!(repo.created_at), json!(repo.pushed_at), json!(repo.language), json!(repo.stars), json!(repo.description)]
    });
    let mut batch = vec![(SQL_CLEAR_REPOS.to_string(), Vec::new())];
    batch.extend(insert_statements("INSERT OR REPLACE INTO", "github_repos", REPO_COLUMNS, rows));
    db.execute_batch(&batch).context("replacing the repositories")
}

pub fn replace_items(db: &SqliteClient, items: &[Item]) -> Result<()> {
    let rows = items.iter().map(|item| {
        vec![json!(item.id), json!(item.kind.as_str()), json!(item.repo), json!(item.number), json!(item.title), json!(item.state), json!(item.merged), json!(item.created_at), json!(item.closed_at), json!(item.url)]
    });
    let mut batch = vec![(SQL_CLEAR_ITEMS.to_string(), Vec::new())];
    batch.extend(insert_statements("INSERT OR REPLACE INTO", "github_items", ITEM_COLUMNS, rows));
    db.execute_batch(&batch).context("replacing the pull requests and issues")
}

/// The days of `year` become `days`. A day outside the year is refused before anything is deleted,
/// since the delete is by year and a stray day would otherwise survive the next replacement.
pub fn replace_days(db: &SqliteClient, year: i32, days: &[Day]) -> Result<()> {
    let first = format!("{year}-01-01");
    let last = format!("{year}-12-31");
    if let Some(stray) = days.iter().find(|day| day.day < first || day.day > last) {
        bail!("{} is not a day of {year}", stray.day);
    }
    let rows = days.iter().map(|day| vec![json!(day.day), json!(day.contributions)]);
    let mut batch = vec![(SQL_CLEAR_YEAR.to_string(), vec![json!(first), json!(last)])];
    batch.extend(insert_statements("INSERT OR REPLACE INTO", "github_days", &["day", "contributions"], rows));
    db.execute_batch(&batch).with_context(|| format!("replacing the days of {year}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::{Day, Item, Kind, Repo};
    use serde_json::json;
    use shared_data::sqlite_client::SqliteClient;
    use std::path::Path;

    fn database() -> SqliteClient {
        let db = SqliteClient::open(Path::new(":memory:")).unwrap();
        crate::schema::apply(&db).unwrap();
        db
    }

    fn repo(name: &str, private: bool) -> Repo {
        Repo { full_name: name.into(), private, fork: false, archived: false, created_at: "2025-01-01T00:00:00Z".into(), pushed_at: None, language: Some("Rust".into()), stars: 2, description: None }
    }

    fn item(id: i64, kind: Kind, merged: bool) -> Item {
        Item { id, kind, repo: "lmfaole/monorepo".into(), number: id, title: format!("Item {id}"), state: "closed".into(), merged, created_at: "2025-05-01T10:00:00Z".into(), closed_at: Some("2025-05-02T10:00:00Z".into()), url: "https://github.com/x".into() }
    }

    #[test]
    fn replace_repos_makes_the_table_what_github_says_now() {
        let db = database();
        replace_repos(&db, &[repo("a/one", true), repo("a/two", false)]).unwrap();

        replace_repos(&db, &[repo("a/two", true)]).unwrap();

        let rows = db.query("SELECT full_name, private, stars, language FROM github_repos", &[]).unwrap();
        assert_eq!(rows, vec![json!({"full_name": "a/two", "private": 1, "stars": 2, "language": "Rust"})]);
    }

    #[test]
    fn replace_items_stores_both_kinds_and_the_merge_flag() {
        let db = database();

        replace_items(&db, &[item(1, Kind::Pr, true), item(2, Kind::Pr, false), item(3, Kind::Issue, false)]).unwrap();

        let rows = db.query("SELECT id, kind, merged FROM github_items ORDER BY id", &[]).unwrap();
        assert_eq!(rows, vec![json!({"id": 1, "kind": "pr", "merged": 1}), json!({"id": 2, "kind": "pr", "merged": 0}), json!({"id": 3, "kind": "issue", "merged": 0})]);
    }

    #[test]
    fn replace_days_replaces_one_year_and_leaves_the_others() {
        let db = database();
        replace_days(&db, 2024, &[Day { day: "2024-03-01".into(), contributions: 4 }]).unwrap();
        replace_days(&db, 2025, &[Day { day: "2025-03-01".into(), contributions: 1 }]).unwrap();

        replace_days(&db, 2024, &[Day { day: "2024-04-02".into(), contributions: 9 }]).unwrap();

        let rows = db.query("SELECT day, contributions FROM github_days ORDER BY day", &[]).unwrap();
        assert_eq!(rows, vec![json!({"day": "2024-04-02", "contributions": 9}), json!({"day": "2025-03-01", "contributions": 1})]);
    }

    #[test]
    fn a_day_outside_the_year_it_was_given_for_is_refused_so_a_year_can_never_wipe_another() {
        let db = database();

        assert!(replace_days(&db, 2024, &[Day { day: "2023-12-31".into(), contributions: 1 }]).is_err());
    }
}
