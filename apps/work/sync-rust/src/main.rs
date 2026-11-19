//! Keeps the owner's GitHub in the local database: the repositories, the pull requests and issues they
//! opened, the contribution calendar and the latest commit in each project of the CV. GitHub keeps it all, so each job replaces what it fetched.
//! Run by hand from `apps/work` (`GITHUB_DB` names another database file); the token is
//! `GITHUB_TOKEN`, else what `gh auth token` prints. Private repositories are in the data, so none of
//! it is ever in a snapshot.

mod client;
mod commits;
mod github;
mod schema;
mod store;

use anyhow::Result;
use chrono::Datelike;
use shared_data::app_db::{open_migrated, path_from_env};
use shared_data::job::{run_jobs, Job};
use shared_data::sqlite_client::SqliteClient;

use crate::client::Client;
use crate::github::{years, Kind};

/// Whose commits the CV shows.
const GITHUB_USER: &str = "lmfaole";

fn repos(db: &SqliteClient, client: &Client) -> Result<()> {
    let repos = client.repos()?;
    store::replace_repos(db, &repos)?;
    println!("{} repositories ({} private)", repos.len(), repos.iter().filter(|repo| repo.private).count());
    Ok(())
}

fn items(db: &SqliteClient, client: &Client) -> Result<()> {
    let user = client.user()?;
    let this_year = chrono::Utc::now().year();
    let mut all = Vec::new();
    // Replaced only when every year of both kinds came back: a failure part-way must not leave a table of half.
    for kind in [Kind::Pr, Kind::Issue] {
        for year in years(user.created_year, this_year) {
            let found = client.items(&user.login, kind, year)?;
            println!("{} {year}: {}", kind.as_str(), found.len());
            all.extend(found);
        }
    }
    store::replace_items(db, &all)?;
    let merged = all.iter().filter(|item| item.merged).count();
    println!("{} pull requests and issues ({merged} merged pull requests)", all.len());
    Ok(())
}

fn contributions(db: &SqliteClient, client: &Client) -> Result<()> {
    let user = client.user()?;
    let mut total = 0;
    for year in years(user.created_year, chrono::Utc::now().year()) {
        let days = client.calendar(year)?;
        total += days.iter().map(|day| day.contributions).sum::<i64>();
        store::replace_days(db, year, &days)?;
        println!("{year}: {} days with contributions", days.len());
    }
    println!("{total} contributions in all");
    Ok(())
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let jobs = [
        Job::new("repos", "replace the repositories with what GitHub lists now", |db: &SqliteClient, _| repos(db, &Client::new()?)),
        Job::new("items", "replace the pull requests and issues the owner opened, year by year", |db, _| items(db, &Client::new()?)),
        Job::new("contributions", "replace each year of the contribution calendar", |db, _| contributions(db, &Client::new()?)),
        Job::new("project-commits", "replace the owner's latest commit in each project repository the CV names (public ones only, no token)", |db, _| {
            commits::sync(db, &path_from_env("CV_DB", "../../.data/cv.db"), GITHUB_USER)
        }),
        Job::new("all", "repos, items, contributions and the project commits", |db, _| {
            let client = Client::new()?;
            repos(db, &client)?;
            items(db, &client)?;
            contributions(db, &client)?;
            commits::sync(db, &path_from_env("CV_DB", "../../.data/cv.db"), GITHUB_USER)
        }),
    ];
    let open = || open_migrated(&path_from_env("GITHUB_DB", "../../.data/github.db"), schema::SCHEMA, "github");
    run_jobs("work-sync", "", &jobs, open, &args)
}
