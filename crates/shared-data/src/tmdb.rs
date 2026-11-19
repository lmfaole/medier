//! The register TMDB, shared by the watch-log apps: the client (the key is `TMDB_API_KEY`: a v3 key, or a v4 read
//! access token, which starts «eyJ»), what a title and year search comes to, the people of a credit, and the tables
//! every register keeps. Each app still owns what its own kind of work says (a film, a series) and how it is stored.

use std::collections::BTreeSet;
use std::path::Path;
use std::time::Duration;

use anyhow::{Context, Result};
use serde_json::{json, Value};

use crate::batch::insert_statements;
use crate::sqlite_client::SqliteClient;
use crate::text::normalize;
use crate::watch_log::Log;

const API: &str = "https://api.themoviedb.org/3";
/// TMDB allows about forty requests a second; a tenth of a second between them stays well inside it.
const PAUSE: Duration = Duration::from_millis(100);
/// Tries per request (the waits between them are `http::backoff`: two, four, eight seconds).
const ATTEMPTS: u32 = 4;
/// At most this many rows fetched before the cover are fetched again in one run, the longest unasked first, so a cover
/// that starts anew is caught up over days instead of in one long run; what a change list names is always fetched.
const STALE_PER_RUN: usize = 150;
/// How far back a first read of a change list goes; what was fetched before it is fetched again once (`cover`).
const CHANGES_DAYS: i64 = 7;
/// How far back TMDB's change lists reach at most: a last read older than this leaves a gap, so the cover starts anew.
const CHANGES_REACH_DAYS: i64 = 14;
/// TMDB answers no page past this one; a day or two of changes, from one daily read to the next, is far under it.
const CHANGES_PAGES: i64 = 500;
/// The candidates a search with no sure answer leaves to choose from.
const CANDIDATES_KEPT: usize = 5;

/// TMDB, asked with the key in `TMDB_API_KEY` and paused between calls to stay inside its rate limit.
pub struct Client {
    http: reqwest::blocking::Client,
    key: String,
}

impl Client {
    pub fn new(user_agent: &str) -> Result<Self> {
        let key = std::env::var("TMDB_API_KEY").context("TMDB_API_KEY is not set: make a free key at themoviedb.org (Settings, API) and put it in the environment of the job")?;
        let http = crate::http::client(user_agent)?;
        Ok(Self { http, key })
    }

    pub fn get(&self, path: &str, query: &[(&str, &str)]) -> Result<Value> {
        self.get_optional(path, query)?.with_context(|| format!("TMDB has nothing at {path}"))
    }

    /// One request, asked again after a timeout, a dropped connection or a busy server: one slow answer at four in the
    /// morning must not fail the whole daily run. The last answer is returned as it is.
    fn send_with_retry(&self, path: &str, query: &[(&str, &str)]) -> Result<reqwest::blocking::Response> {
        let mut attempt = 0;
        loop {
            let mut request = self.http.get(format!("{API}{path}")).query(query);
            request = if self.key.starts_with("eyJ") { request.bearer_auth(&self.key) } else { request.query(&[("api_key", self.key.as_str())]) };
            let result = request.send();
            attempt += 1;
            let again = match &result {
                Ok(response) => crate::http::is_retryable(response.status()),
                Err(error) => crate::http::is_transient(error),
            };
            if !again || attempt >= ATTEMPTS {
                return result.with_context(|| format!("asking TMDB for {path}"));
            }
            std::thread::sleep(crate::http::backoff(attempt));
        }
    }

    /// Like `get`, but `None` where TMDB says the thing is gone (404), so one removed person does not stop a whole refresh.
    pub fn get_optional(&self, path: &str, query: &[(&str, &str)]) -> Result<Option<Value>> {
        let response = self.send_with_retry(path, query)?;
        std::thread::sleep(PAUSE);
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        let answer = response.error_for_status().with_context(|| format!("asking TMDB for {path}"))?.json().context("reading TMDB's answer")?;
        Ok(Some(answer))
    }

    /// The numbers TMDB says changed from the day of `since` (unix seconds) to today, from a `…/changes` list (all of its
    /// pages), or `None` when the list has more pages than TMDB serves, so it cannot vouch for anything.
    pub fn changed(&self, path: &str, since: i64) -> Result<Option<BTreeSet<i64>>> {
        let from = chrono::DateTime::from_timestamp(since, 0).map(|at| at.date_naive().to_string()).context("a start for the change list")?;
        let to = chrono::Utc::now().date_naive().to_string();
        let mut ids = BTreeSet::new();
        let mut page = 1;
        loop {
            let answer = self.get(path, &[("start_date", from.as_str()), ("end_date", to.as_str()), ("page", page.to_string().as_str())])?;
            let pages = answer["total_pages"].as_i64().unwrap_or(1);
            if pages > CHANGES_PAGES {
                return Ok(None);
            }
            ids.extend(answer["results"].as_array().into_iter().flatten().filter_map(|item| item["id"].as_i64()));
            if page >= pages {
                return Ok(Some(ids));
            }
            page += 1;
        }
    }
}

/// How much of what is stored a `tmdb` run fetches again.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refresh {
    /// Only what has no answer yet.
    No,
    /// What TMDB lists as changed since it was fetched, and what is too old for the lists to tell.
    Changed,
    /// All of it.
    Everything,
    /// Every stored work's details again, with no search and no people: for a change in how titles are chosen.
    Titles,
}

impl Refresh {
    #[must_use]
    pub fn from_flags(refresh: bool, everything: bool) -> Self {
        if everything {
            Self::Everything
        } else if refresh {
            Self::Changed
        } else {
            Self::No
        }
    }
}

/// Where a read of a change list starts, and from when the rows not named in it are vouched for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Cover {
    pub since: i64,
    pub covered_from: i64,
}

/// The cover of the next read, from the last one (`covered_from`, `checked_at`): it starts on the day of that read (a
/// list's start date counts the whole day), so the lists overlap and the cover goes on unbroken, and a daily read is
/// about one day of changes. With no read, or one TMDB's lists no longer reach back to, it starts `CHANGES_DAYS` ago
/// and vouches for nothing older, so what was fetched before is fetched once more.
#[must_use]
pub fn cover(last: Option<(i64, i64)>, now: i64) -> Cover {
    let day = |at: i64| at - at.rem_euclid(86_400);
    match last {
        Some((covered_from, checked_at)) if checked_at > now - (CHANGES_REACH_DAYS - 1) * 86_400 => Cover { since: day(checked_at), covered_from },
        _ => {
            let since = day(now - CHANGES_DAYS * 86_400);
            Cover { since, covered_from: since }
        }
    }
}

/// The stored numbers (with when each was fetched) that are due: every one the change list names, and of those fetched
/// before the cover starts (all of them when there is no list to go by: `None`, more pages than TMDB serves) the
/// `stale_budget` longest unasked.
#[must_use]
pub fn due(stored: &[(i64, i64)], changed: Option<&BTreeSet<i64>>, covered_from: i64, stale_budget: usize) -> Vec<i64> {
    let named = |id: &i64| changed.is_some_and(|changed| changed.contains(id));
    let mut stale: Vec<(i64, i64)> = stored.iter().filter(|(id, fetched_at)| !named(id) && (changed.is_none() || *fetched_at < covered_from)).copied().collect();
    stale.sort_unstable_by_key(|(id, fetched_at)| (*fetched_at, *id));
    let mut ids: Vec<i64> = stored.iter().map(|(id, _)| *id).filter(named).chain(stale.into_iter().take(stale_budget).map(|(id, _)| id)).collect();
    ids.sort_unstable();
    ids
}

const SQL_CHECKED: &str = "SELECT covered_from, checked_at FROM {} WHERE list = ?";
const SQL_STORE_CHECKED: &str = "INSERT OR REPLACE INTO {} (list, covered_from, checked_at) VALUES (?, ?, ?)";

/// One of a register's change lists: its name in `<register>_tmdb_checked`, TMDB's path to it, and the table and
/// number column it vouches for.
struct ChangeList<'a> {
    name: &'a str,
    path: &'a str,
    table: String,
    column: &'a str,
}

/// What a change list says is due, and the cover to keep once those are fetched: a read with no list to go by fetches
/// everything, so its cover starts at that read.
fn due_by_list(db: &SqliteClient, client: &Client, register: &Register, list: &ChangeList, now: i64) -> Result<(Vec<i64>, Cover)> {
    let previous = db
        .query(&SQL_CHECKED.replace("{}", &register.checked()), &[json!(list.name)])?
        .first()
        .and_then(|row| Some((row["covered_from"].as_i64()?, row["checked_at"].as_i64()?)));
    let cover = cover(previous, now);
    let changed = client.changed(list.path, cover.since)?;
    let ids = due(&fetched(db, &list.table, list.column)?, changed.as_ref(), cover.covered_from, STALE_PER_RUN);
    Ok((ids, if changed.is_some() { cover } else { Cover { since: cover.since, covered_from: cover.since } }))
}

fn store_cover(db: &SqliteClient, register: &Register, list: &str, cover: Cover, now: i64) -> Result<()> {
    db.execute(&SQL_STORE_CHECKED.replace("{}", &register.checked()), &[json!(list), json!(cover.covered_from), json!(now)])
}

/// The numbers a table holds, with when they were fetched.
fn fetched(db: &SqliteClient, table: &str, column: &str) -> Result<Vec<(i64, i64)>> {
    let rows = db.query(&format!("SELECT {column} AS id, fetched_at FROM {table}"), &[])?;
    Ok(rows.iter().filter_map(|row| Some((row["id"].as_i64()?, row["fetched_at"].as_i64()?))).collect())
}

/// Keeps an answer where a rebuild can find it, written once: the originals under `.data/raw/<source>/<date>/`.
pub fn land(path: &Path, answer: &Value) -> Result<()> {
    if !path.exists() {
        std::fs::write(path, serde_json::to_string_pretty(answer)?).with_context(|| format!("landing {}", path.display()))?;
    }
    Ok(())
}

/// The non-empty text of a field, trimmed.
#[must_use]
pub fn text(value: &Value) -> Option<String> {
    value.as_str().map(str::trim).filter(|text| !text.is_empty()).map(str::to_string)
}

/// A count the register writes as 0 when it has none.
#[must_use]
pub fn positive(value: &Value) -> Option<i64> {
    value.as_i64().filter(|number| *number > 0)
}

/// The year of a `YYYY-MM-DD` day.
#[must_use]
pub fn year_of(date: &str) -> Option<i64> {
    date.get(..4)?.parse().ok()
}

/// The fields a search answer names a work with: a film's `title`, `original_title` and `release_date`, a series'
/// `name`, `original_name` and `first_air_date`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Shape {
    Film,
    Series,
}

impl Shape {
    fn fields(self) -> (&'static str, &'static str, &'static str) {
        match self {
            Self::Film => ("title", "original_title", "release_date"),
            Self::Series => ("name", "original_name", "first_air_date"),
        }
    }
}

/// One result of a search.
#[derive(Debug, Clone, PartialEq)]
pub struct Hit {
    pub id: i64,
    pub title: String,
    pub year: Option<i64>,
    pub popularity: f64,
}

/// The results of a search, each with the original title beside it.
fn hits_in(answer: &Value, shape: Shape) -> Vec<(Hit, String)> {
    let (title_field, original_field, date_field) = shape.fields();
    answer["results"]
        .as_array()
        .map(|results| {
            results
                .iter()
                .filter_map(|result| {
                    let title = result[title_field].as_str().unwrap_or_default().to_string();
                    let original = result[original_field].as_str().unwrap_or_default().to_string();
                    Some((Hit { id: result["id"].as_i64()?, title, year: year_of(result[date_field].as_str().unwrap_or_default()), popularity: result["popularity"].as_f64().unwrap_or_default() }, original))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// What a search came to: the work's number, or the candidates to choose from.
#[derive(Debug, Clone, PartialEq)]
pub enum Found {
    Number(i64),
    Candidates(Vec<Hit>),
}

/// The work a title and year name among a search's results: the title (or the original title) must be the same and
/// the year too, when there is one. None of them gives the first few hits to choose from.
#[must_use]
pub fn pick(answer: &Value, title: &str, year: i64, shape: Shape) -> Found {
    let wanted = normalize(title);
    let hits = hits_in(answer, shape);
    let mut same: Vec<&Hit> = hits
        .iter()
        .filter(|(hit, original)| (normalize(&hit.title) == wanted || normalize(original) == wanted) && (year == 0 || hit.year == Some(year)))
        .map(|(hit, _)| hit)
        .collect();
    same.sort_by(|a, b| b.popularity.total_cmp(&a.popularity));
    match same.first() {
        Some(hit) => Found::Number(hit.id),
        None => Found::Candidates(hits.into_iter().map(|(hit, _)| hit).take(CANDIDATES_KEPT).collect()),
    }
}

/// The people of a details answer, folded into the few jobs the pages show.
pub struct Credits<'a> {
    /// The register's job names and what the pages call them; the first that matches wins.
    pub jobs: &'a [(&'a str, &'a str)],
    /// The job the register's own `created_by` list gets (a series' creators); empty for a work that has none.
    pub created_by: &'a str,
    pub creators_kept: usize,
    pub producers_kept: usize,
    pub cast_kept: usize,
}

/// The people of a details answer, in the order a page shows them: the register's creators, then the folded crew jobs
/// and last the first of the cast, each with the position it is shown in.
#[must_use]
pub fn credits_in(answer: &Value, rules: &Credits) -> Vec<(i64, String, String, Option<String>, i64)> {
    let mut credits = Vec::new();
    for (position, creator) in answer["created_by"].as_array().into_iter().flatten().take(rules.creators_kept).enumerate() {
        if let (Some(person), Some(name)) = (creator["id"].as_i64(), text(&creator["name"])) {
            credits.push((person, name, rules.created_by.to_string(), None, i64::try_from(position).unwrap_or(0)));
        }
    }
    let mut producers = 0;
    for crew in answer["credits"]["crew"].as_array().into_iter().flatten() {
        let Some(job) = rules.jobs.iter().find(|(register, _)| crew["job"] == *register).map(|(_, kept)| *kept) else { continue };
        if job == "Producer" {
            producers += 1;
            if producers > rules.producers_kept {
                continue;
            }
        }
        if let (Some(person), Some(name)) = (crew["id"].as_i64(), text(&crew["name"])) {
            credits.push((person, name, job.to_string(), None, i64::try_from(credits.len()).unwrap_or(0)));
        }
    }
    for (position, cast) in answer["credits"]["cast"].as_array().into_iter().flatten().take(rules.cast_kept).enumerate() {
        if let (Some(person), Some(name)) = (cast["id"].as_i64(), text(&cast["name"])) {
            credits.push((person, name, "Cast".to_string(), text(&cast["character"]), i64::try_from(position).unwrap_or(0)));
        }
    }
    credits
}

/// The names the register lists in a list of objects: a work's genres, or its keywords (a film lists them under
/// `keywords`, a series under `results`).
#[must_use]
pub fn names_in(answer: &Value, list: &str) -> Vec<String> {
    answer[list].as_array().into_iter().flatten().filter_map(|entry| text(&entry["name"])).collect()
}

/// The countries a work was made in, as (ISO 3166-1 code, name).
#[must_use]
pub fn countries_in(answer: &Value) -> Vec<(String, String)> {
    answer["production_countries"].as_array().into_iter().flatten().filter_map(|country| Some((text(&country["iso_3166_1"])?, text(&country["name"])?))).collect()
}

/// The languages spoken in a work, as (ISO 639-1 code, the register's English name).
#[must_use]
pub fn languages_in(answer: &Value) -> Vec<(String, String)> {
    answer["spoken_languages"].as_array().into_iter().flatten().filter_map(|language| Some((text(&language["iso_639_1"])?, text(&language["english_name"]).or_else(|| text(&language["name"]))?))).collect()
}

/// The companies that made a work, as (name, country), the first `kept` of them.
#[must_use]
pub fn companies_in(answer: &Value, kept: usize) -> Vec<(String, Option<String>)> {
    answer["production_companies"].as_array().into_iter().flatten().filter_map(|company| Some((text(&company["name"])?, text(&company["origin_country"])))).take(kept).collect()
}

/// The networks a series is shown on, as (network, name, country, position): the place the tv pages count.
#[must_use]
pub fn networks_in(answer: &Value) -> Vec<(i64, String, Option<String>, i64)> {
    answer["networks"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
        .filter_map(|(position, network)| Some((network["id"].as_i64()?, text(&network["name"])?, text(&network["origin_country"]), i64::try_from(position).unwrap_or(0))))
        .collect()
}

/// A person of a credit, as the register has them.
#[derive(Debug, Clone, PartialEq)]
pub struct Person {
    pub id: i64,
    pub name: String,
    pub birthday: Option<String>,
    pub deathday: Option<String>,
    pub place_of_birth: Option<String>,
    pub biography: Option<String>,
    pub department: Option<String>,
    pub imdb_id: Option<String>,
}

pub fn parse_person(answer: &Value) -> Result<Person> {
    Ok(Person {
        id: answer["id"].as_i64().context("the answer has no id")?,
        name: text(&answer["name"]).context("the person has no name")?,
        birthday: text(&answer["birthday"]),
        deathday: text(&answer["deathday"]),
        place_of_birth: text(&answer["place_of_birth"]),
        biography: text(&answer["biography"]),
        department: text(&answer["known_for_department"]),
        imdb_id: text(&answer["imdb_id"]),
    })
}

/// The register tables of one watch-log app: the same shape in every one, named for its domain.
#[derive(Debug, Clone, Copy)]
pub struct Register {
    /// The domain every table is named after: `film`, `tv`.
    pub prefix: &'static str,
}

impl Register {
    #[must_use]
    pub fn watch(&self) -> String {
        self.table("watch")
    }
    #[must_use]
    pub fn collection(&self) -> String {
        self.table("collection")
    }
    #[must_use]
    pub fn matches(&self) -> String {
        self.table("match")
    }
    #[must_use]
    pub fn title(&self) -> String {
        self.table("title")
    }
    #[must_use]
    pub fn genre(&self) -> String {
        self.table("genre")
    }
    #[must_use]
    pub fn country(&self) -> String {
        self.table("country")
    }
    #[must_use]
    pub fn language(&self) -> String {
        self.table("language")
    }
    #[must_use]
    pub fn credit(&self) -> String {
        self.table("credit")
    }
    #[must_use]
    pub fn company(&self) -> String {
        self.table("company")
    }
    #[must_use]
    pub fn keyword(&self) -> String {
        self.table("keyword")
    }
    /// The works the register recommends beside one.
    #[must_use]
    pub fn related(&self) -> String {
        self.table("related")
    }
    #[must_use]
    pub fn person(&self) -> String {
        self.table("person")
    }
    /// How far the change lists vouch for the stored works and people (`cover`).
    #[must_use]
    pub fn checked(&self) -> String {
        self.table("tmdb_checked")
    }
    fn table(&self, name: &str) -> String {
        format!("{}_{name}", self.prefix)
    }
}

/// Everything a register keeps beside a work's own row, replaced together for one number.
#[derive(Debug, Clone, PartialEq)]
pub struct Facets {
    pub genres: Vec<String>,
    /// (code, name)
    pub countries: Vec<(String, String)>,
    /// (ISO 639-1 code, English name): the languages spoken
    pub languages: Vec<(String, String)>,
    /// (person, name, job, character, position)
    pub credits: Vec<(i64, String, String, Option<String>, i64)>,
    /// (company, country)
    pub companies: Vec<(String, Option<String>)>,
    pub keywords: Vec<String>,
    /// (number, title, day, poster): the works the register recommends, best first
    pub related: Vec<(i64, String, Option<String>, Option<String>)>,
}

/// How many recommendations are kept beside a work.
const RELATED_KEPT: usize = 12;

/// The works a details answer (with `recommendations` appended) recommends: a film has `title` and `release_date`, a series `name` and
/// `first_air_date`, so each is read either way.
#[must_use]
pub fn related_in(answer: &Value) -> Vec<(i64, String, Option<String>, Option<String>)> {
    answer["recommendations"]["results"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|work| {
            let day = text(&work["release_date"]).or_else(|| text(&work["first_air_date"])).and_then(|day| day.get(..10).map(str::to_string));
            Some((work["id"].as_i64()?, text(&work["title"]).or_else(|| text(&work["name"]))?, day, text(&work["poster_path"])))
        })
        .take(RELATED_KEPT)
        .collect()
}

/// Everything kept beside a work, read from its details answer. `keywords` is the list the register puts them in
/// (`keywords` for a film, `results` for a series), and `rules` is what is kept of its credits.
#[must_use]
pub fn facets_in(answer: &Value, rules: &Credits, keywords: &str, companies_kept: usize, keywords_kept: usize) -> Facets {
    Facets {
        genres: names_in(answer, "genres"),
        countries: countries_in(answer),
        languages: languages_in(answer),
        credits: credits_in(answer, rules),
        companies: companies_in(answer, companies_kept),
        keywords: names_in(&answer["keywords"], keywords).into_iter().take(keywords_kept).collect(),
        related: related_in(answer),
    }
}

/// What every register keeps about a work itself, read the same way from a film's or a series' details answer: the
/// poster and the words the page shows, the register's own vote, and the ids on `IMDb` and Wikidata.
#[derive(Debug, Clone, PartialEq)]
pub struct Work {
    pub overview: Option<String>,
    pub tagline: Option<String>,
    pub poster_path: Option<String>,
    /// The wide picture of the work, a file name under image.tmdb.org with a leading slash.
    pub backdrop_path: Option<String>,
    pub original_language: Option<String>,
    pub vote_average: Option<f64>,
    pub vote_count: Option<i64>,
    pub imdb_id: Option<String>,
    pub wikidata_id: Option<String>,
}

impl Work {
    #[must_use]
    pub fn of(answer: &Value) -> Self {
        Self {
            overview: text(&answer["overview"]),
            tagline: text(&answer["tagline"]),
            poster_path: text(&answer["poster_path"]),
            backdrop_path: text(&answer["backdrop_path"]),
            original_language: text(&answer["original_language"]),
            vote_average: answer["vote_average"].as_f64().filter(|average| *average > 0.0),
            vote_count: positive(&answer["vote_count"]),
            imdb_id: text(&answer["external_ids"]["imdb_id"]).or_else(|| text(&answer["imdb_id"])),
            wikidata_id: text(&answer["external_ids"]["wikidata_id"]),
        }
    }
}

/// Remembers what a search came to for a title and year.
pub fn store_match(db: &SqliteClient, register: &Register, title: &str, year: i64, found: &Found, now: i64) -> Result<()> {
    let (id, candidates) = match found {
        Found::Number(id) => (json!(id), Value::Null),
        Found::Candidates(hits) => (Value::Null, json!(serde_json::to_string(&hits.iter().map(|hit| json!({ "id": hit.id, "title": hit.title, "year": hit.year })).collect::<Vec<_>>())?)),
    };
    db.execute(&format!("INSERT OR REPLACE INTO {} (title, year, tmdb_id, candidates, tried_at) VALUES (?, ?, ?, ?, ?)", register.matches()), &[json!(title), json!(year), id, candidates, json!(now)])
}

/// Replaces what is stored about a person. `language` is the one the biography is in.
pub fn store_person(db: &SqliteClient, register: &Register, person: &Person, language: &str, now: i64) -> Result<()> {
    db.execute(
        &format!(
            "INSERT OR REPLACE INTO {} (person_id, name, birthday, deathday, place_of_birth, biography, biography_language, department, imdb_id, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            register.person()
        ),
        &[json!(person.id), json!(person.name), json!(person.birthday), json!(person.deathday), json!(person.place_of_birth), json!(person.biography), json!(person.biography.as_ref().map(|_| language)), json!(person.department), json!(person.imdb_id), json!(now)],
    )
}

/// The register's numbers of every work that is to have its details: those the log and the collection name and those a search found.
pub fn wanted(db: &SqliteClient, register: &Register, refresh: bool) -> Result<Vec<i64>> {
    let filter = if refresh { String::new() } else { format!("AND tmdb_id NOT IN (SELECT tmdb_id FROM {})", register.title()) };
    let sql = format!(
        "SELECT tmdb_id FROM (SELECT tmdb_id FROM {} WHERE tmdb_id IS NOT NULL UNION SELECT tmdb_id FROM {} WHERE tmdb_id IS NOT NULL UNION SELECT tmdb_id FROM {} WHERE tmdb_id IS NOT NULL) WHERE tmdb_id IS NOT NULL {filter} ORDER BY tmdb_id",
        register.watch(),
        register.collection(),
        register.matches()
    );
    Ok(db.query(&sql, &[])?.iter().filter_map(|row| row["tmdb_id"].as_i64()).collect())
}

/// The titles the logs name that have no register number yet, each once, in the order the logs name them.
#[must_use]
pub fn unresolved(db: &SqliteClient, logs: &[&Log]) -> Vec<(String, i64)> {
    let mut titles = Vec::new();
    for title in logs.iter().flat_map(|log| log.unresolved(db)) {
        if !titles.contains(&title) {
            titles.push(title);
        }
    }
    titles
}

/// The titles the log names that have not been searched for yet.
#[must_use]
pub fn unsearched(db: &SqliteClient, register: &Register, refresh: bool, unresolved: Vec<(String, i64)>) -> Vec<(String, i64)> {
    unresolved
        .into_iter()
        .filter(|(title, year)| refresh || db.query(&format!("SELECT 1 AS found FROM {} WHERE title = ? AND year = ?", register.matches()), &[json!(title), json!(year)]).map_or(true, |rows| rows.is_empty()))
        .collect()
}

/// The people of the stored credits that have no details yet.
pub fn people_wanted(db: &SqliteClient, register: &Register, refresh: bool) -> Result<Vec<i64>> {
    let filter = if refresh { String::new() } else { format!("WHERE person_id NOT IN (SELECT person_id FROM {})", register.person()) };
    let sql = format!("SELECT DISTINCT person_id FROM {} {filter} ORDER BY person_id", register.credit());
    Ok(db.query(&sql, &[])?.iter().filter_map(|row| row["person_id"].as_i64()).collect())
}

/// Replaces the genres, countries, credits, companies and keywords stored beside one work.
pub fn store_facets(db: &SqliteClient, register: &Register, id: i64, facets: &Facets) -> Result<()> {
    let id = json!(id);
    let mut batch: Vec<(String, Vec<Value>)> = [register.genre(), register.country(), register.language(), register.credit(), register.company(), register.keyword(), register.related()]
        .iter()
        .map(|table| (format!("DELETE FROM {table} WHERE tmdb_id = ?"), vec![id.clone()]))
        .collect();
    batch.extend(insert_statements("INSERT OR IGNORE INTO", &register.company(), &["tmdb_id", "company", "country"], facets.companies.iter().map(|(company, country)| vec![id.clone(), json!(company), json!(country)])));
    batch.extend(insert_statements("INSERT OR IGNORE INTO", &register.keyword(), &["tmdb_id", "keyword"], facets.keywords.iter().map(|keyword| vec![id.clone(), json!(keyword)])));
    batch.extend(insert_statements("INSERT OR IGNORE INTO", &register.genre(), &["tmdb_id", "genre"], facets.genres.iter().map(|genre| vec![id.clone(), json!(genre)])));
    batch.extend(insert_statements("INSERT OR IGNORE INTO", &register.country(), &["tmdb_id", "code", "country"], facets.countries.iter().map(|(code, name)| vec![id.clone(), json!(code), json!(name)])));
    batch.extend(insert_statements("INSERT OR IGNORE INTO", &register.language(), &["tmdb_id", "code", "language"], facets.languages.iter().map(|(code, name)| vec![id.clone(), json!(code), json!(name)])));
    batch.extend(insert_statements(
        "INSERT OR IGNORE INTO",
        &register.credit(),
        &["tmdb_id", "person_id", "name", "job", "character", "position"],
        facets.credits.iter().map(|(person, name, job, character, position)| vec![id.clone(), json!(person), json!(name), json!(job), json!(character), json!(position)]),
    ));
    batch.extend(related_inserts(register, &id, &facets.related));
    db.execute_batch(&batch).context("writing what the register says beside a work")
}

fn related_inserts(register: &Register, id: &Value, related: &[(i64, String, Option<String>, Option<String>)]) -> Vec<(String, Vec<Value>)> {
    insert_statements(
        "INSERT OR IGNORE INTO",
        &register.related(),
        &["tmdb_id", "related_id", "title", "day", "poster_path", "position"],
        related.iter().enumerate().map(|(position, (number, title, day, poster))| vec![id.clone(), json!(number), json!(title), json!(day), json!(poster), json!(position)]),
    )
}

/// The works already stored that have no recommendations yet: what `run_related` asks for.
pub fn related_wanted(db: &SqliteClient, register: &Register) -> Result<Vec<i64>> {
    let sql = format!("SELECT t.tmdb_id AS id FROM {} AS t WHERE NOT EXISTS (SELECT 1 FROM {} AS r WHERE r.tmdb_id = t.tmdb_id) ORDER BY t.tmdb_id", register.title(), register.related());
    Ok(db.query(&sql, &[])?.iter().filter_map(|row| row["id"].as_i64()).collect())
}

/// The `related` job: the recommendations of the stored works that have none, so a register that began keeping them late is filled in
/// without fetching every person again. A work the register recommends nothing for is asked for again each time, which is one request.
pub fn run_related(db: &SqliteClient, pull: &Pull) -> Result<()> {
    let ids = related_wanted(db, &pull.register)?;
    if ids.is_empty() {
        println!("related: none to fetch");
        return Ok(());
    }
    let client = Client::new(pull.agent)?;
    let mut kept = 0;
    for id in &ids {
        let Some(answer) = client.get_optional(&pull.details.replace("{}", &id.to_string()), &[("language", "no-NO"), ("append_to_response", "recommendations")])? else { continue };
        let related = related_in(&answer);
        kept += related.len();
        let mut batch = vec![(format!("DELETE FROM {} WHERE tmdb_id = ?", pull.register.related()), vec![json!(id)])];
        batch.extend(related_inserts(&pull.register, &json!(id), &related));
        db.execute_batch(&batch).with_context(|| format!("writing the recommendations of {id}"))?;
    }
    println!("related: {} {} asked about, {kept} recommendations kept", ids.len(), pull.noun);
    Ok(())
}

/// The register pull of one app: what it looks up, what it asks for and what it calls the work.
#[derive(Debug, Clone, Copy)]
pub struct Pull<'a> {
    pub register: Register,
    pub shape: Shape,
    /// The search endpoint: `/search/movie`, `/search/tv`.
    pub search: &'a str,
    /// The details endpoint, with `{}` where the number goes.
    pub details: &'a str,
    /// The list of what changed lately: `/movie/changes`, `/tv/changes`.
    pub changes: &'a str,
    /// The `append_to_response` the details ask for.
    pub append: &'a str,
    /// What the app calls its works in the closing line: `films`, `series`.
    pub noun: &'a str,
    /// The user agent TMDB is asked with, which names the app.
    pub agent: &'a str,
}

/// Whether a details answer already has a Norwegian title: one that differs from the original's, or an original that is Norwegian.
#[must_use]
pub fn has_norwegian_title(answer: &Value) -> bool {
    if matches!(answer["original_language"].as_str(), Some("no" | "nb")) {
        return true;
    }
    let title = text(&answer["title"]).or_else(|| text(&answer["name"]));
    let original = text(&answer["original_title"]).or_else(|| text(&answer["original_name"]));
    title.is_some() && title != original
}

/// Whether a text has a letter from a script beyond the Latin, Greek and Cyrillic ones (Japanese, Chinese, Korean, Hebrew, Arabic, Thai, Devanagari …).
fn has_non_western_script(text: &str) -> bool {
    text.chars().any(|c| c.is_alphabetic() && (c as u32) >= 0x590)
}

/// A work's details in Norwegian where TMDB has it. TMDB keeps most Norwegian titles under `no` and a few under `nb`, so `no-NO` is asked
/// first and `nb-NO` only when that gave the original's title. A title still in a non-Western script is then the English one from `en-US`
/// where TMDB has it, so a Japanese film is not shown in kanji; the rest of the answer stays Norwegian. Otherwise the original's title is the answer.
fn norwegian_details(client: &Client, pull: &Pull, id: i64) -> Result<Value> {
    let path = pull.details.replace("{}", &id.to_string());
    let ask = |language: &str| client.get_optional(&path, &[("language", language), ("append_to_response", pull.append)]);
    let primary = ask("no-NO")?.with_context(|| format!("TMDB has nothing at {path}"))?;
    if has_norwegian_title(&primary) {
        return Ok(primary);
    }
    let mut answer = ask("nb-NO")?.filter(has_norwegian_title).unwrap_or(primary);
    if !has_norwegian_title(&answer) {
        if let Some(english) = ask("en-US")? {
            english_title_into(&mut answer, &english);
        }
    }
    Ok(answer)
}

/// Puts the English title of `english` into `answer` when `answer`'s own is in a non-Western script and the English one is not.
fn english_title_into(answer: &mut Value, english: &Value) {
    for field in ["title", "name"] {
        let (Some(own), Some(wanted)) = (text(&answer[field]), text(&english[field])) else { continue };
        if has_non_western_script(&own) && !has_non_western_script(&wanted) {
            answer[field] = json!(wanted);
        }
    }
}

/// The details of each number, landed and stored.
fn fetch_details(client: &Client, pull: &Pull, directory: &Path, ids: &[i64], now: i64, store: &impl Fn(&SqliteClient, &Value, i64) -> Result<()>, db: &SqliteClient) -> Result<()> {
    for id in ids {
        let answer = norwegian_details(client, pull, *id)?;
        land(&directory.join(format!("{}-{id}.json", pull.register.prefix)), &answer)?;
        store(db, &answer, now)?;
    }
    Ok(())
}

/// The `tmdb` job: find the works the log names without a number, fetch each one's details and then every person of
/// a credit, landing every answer and storing what `store` makes of a details answer.
pub fn run(db: &SqliteClient, pull: &Pull, refresh: Refresh, unresolved: Vec<(String, i64)>, store: impl Fn(&SqliteClient, &Value, i64) -> Result<()>) -> Result<()> {
    let client = Client::new(pull.agent)?;
    let directory = crate::raw::landing_path("tmdb", chrono::Utc::now().date_naive())?;
    std::fs::create_dir_all(&directory).with_context(|| format!("creating {}", directory.display()))?;
    let now = chrono::Utc::now().timestamp();
    let (mut matched, mut unsure) = (0, 0);
    for (title, year) in unsearched(db, &pull.register, refresh == Refresh::Everything, if refresh == Refresh::Titles { Vec::new() } else { unresolved }) {
        let mut query = vec![("query", title.as_str()), ("include_adult", "false")];
        let year_text = year.to_string();
        if year != 0 {
            query.push(("year", year_text.as_str()));
        }
        let answer = client.get(pull.search, &query)?;
        land(&directory.join(format!("search-{}-{year}.json", crate::text::slug(&title))), &answer)?;
        let found = pick(&answer, &title, year, pull.shape);
        match &found {
            Found::Number(_) => matched += 1,
            Found::Candidates(_) => unsure += 1,
        }
        store_match(db, &pull.register, &title, year, &found, now)?;
    }
    let mut ids = wanted(db, &pull.register, matches!(refresh, Refresh::Everything | Refresh::Titles))?;
    let mut title_cover = None;
    if refresh == Refresh::Changed {
        let list = ChangeList { name: "titles", path: pull.changes, table: pull.register.title(), column: "tmdb_id" };
        let (due_ids, cover) = due_by_list(db, &client, &pull.register, &list, now)?;
        ids.extend(due_ids);
        ids.sort_unstable();
        ids.dedup();
        title_cover = Some(cover);
    }
    fetch_details(&client, pull, &directory, &ids, now, &store, db)?;
    if let Some(cover) = title_cover {
        store_cover(db, &pull.register, "titles", cover, now)?;
    }
    let mut people = if refresh == Refresh::Titles { Vec::new() } else { people_wanted(db, &pull.register, refresh == Refresh::Everything)? };
    let mut people_cover = None;
    if refresh == Refresh::Changed {
        let list = ChangeList { name: "people", path: "/person/changes", table: pull.register.person(), column: "person_id" };
        let (due_ids, cover) = due_by_list(db, &client, &pull.register, &list, now)?;
        people.extend(due_ids);
        people.sort_unstable();
        people.dedup();
        people_cover = Some(cover);
    }
    for id in &people {
        let Some(mut answer) = client.get_optional(&format!("/person/{id}"), &[("language", "nb-NO")])? else { continue };
        let mut language = "nb";
        if text(&answer["biography"]).is_none() {
            let english = client.get(&format!("/person/{id}"), &[("language", "en-US")])?;
            land(&directory.join(format!("person-{id}-en.json")), &english)?;
            answer["biography"] = english["biography"].clone();
            language = "en";
        }
        land(&directory.join(format!("person-{id}.json")), &answer)?;
        store_person(db, &pull.register, &parse_person(&answer)?, language, now)?;
    }
    if let Some(cover) = people_cover {
        store_cover(db, &pull.register, "people", cover, now)?;
    }
    println!("tmdb: {matched} titles matched, {unsure} left for you to settle (in {}; write the register's number in the log), {} {} and {} people fetched", pull.register.matches(), ids.len(), pull.noun, people.len());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{cover, due, pick, related_in, year_of, Cover, Found, Refresh, Shape};
    use std::collections::BTreeSet;
    use serde_json::json;

    #[test]
    fn a_series_is_found_by_its_name_and_first_air_year_where_a_film_is_not() {
        let answer = json!({"results": [
            {"id": 1, "name": "Heat", "original_name": "Heat", "first_air_date": "1995-12-15", "popularity": 50.0},
            {"id": 2, "name": "Sult", "original_name": "Hunger", "first_air_date": "2008-10-31", "popularity": 20.0},
            {"id": 3, "title": "Heat", "original_title": "Heat", "release_date": "1995-12-15", "popularity": 90.0}
        ]});
        assert_eq!(pick(&answer, "heat", 1995, Shape::Series), Found::Number(1));
        assert_eq!(pick(&answer, "Hunger", 2008, Shape::Series), Found::Number(2));
        assert!(matches!(pick(&answer, "Heat", 2001, Shape::Series), Found::Candidates(hits) if hits.len() == 3));
        // One answer read as a series and as a film: each shape sees only its own fields.
        assert_eq!(pick(&answer, "Heat", 1995, Shape::Film), Found::Number(3));
        assert_eq!(year_of("2008-10-31"), Some(2008));
        assert_eq!(year_of(""), None);
    }

    #[test]
    fn the_recommendations_of_a_film_or_a_series_are_read_either_way_best_first() {
        let answer = json!({"recommendations": {"results": [
            {"id": 1, "title": "Heat", "release_date": "1995-12-15", "poster_path": "/h.jpg"},
            {"id": 2, "name": "Sult", "first_air_date": "2008-10-31"},
            {"id": 3, "title": "  "}
        ]}});
        assert_eq!(related_in(&answer), vec![(1, "Heat".to_string(), Some("1995-12-15".to_string()), Some("/h.jpg".to_string())), (2, "Sult".to_string(), Some("2008-10-31".to_string()), None)]);
        assert!(related_in(&json!({})).is_empty());
    }

    #[test]
    fn a_title_is_norwegian_when_it_differs_from_the_original_or_the_original_is_norwegian() {
        use super::has_norwegian_title;
        assert!(has_norwegian_title(&json!({"title": "Oppdrag Nemo", "original_title": "Finding Nemo", "original_language": "en"})));
        assert!(!has_norwegian_title(&json!({"title": "Finding Nemo", "original_title": "Finding Nemo", "original_language": "en"})));
        assert!(has_norwegian_title(&json!({"title": "Elling", "original_title": "Elling", "original_language": "no"})));
        assert!(has_norwegian_title(&json!({"name": "Skam", "original_name": "Shame", "original_language": "en"})));
        assert!(!has_norwegian_title(&json!({"id": 1})));
    }

    #[test]
    fn a_title_in_a_non_western_script_is_replaced_by_the_english_one() {
        use super::english_title_into;
        let mut answer = json!({"title": "ゴジラ-0.0", "original_title": "ゴジラ-0.0", "overview": "Norsk"});
        english_title_into(&mut answer, &json!({"title": "Godzilla Minus Zero"}));
        assert_eq!(answer["title"], "Godzilla Minus Zero");
        assert_eq!(answer["original_title"], "ゴジラ-0.0");
        assert_eq!(answer["overview"], "Norsk");
        let mut latin = json!({"title": "Amélie"});
        english_title_into(&mut latin, &json!({"title": "Amelie"}));
        assert_eq!(latin["title"], "Amélie");
        let mut same = json!({"title": "ゴジラ"});
        english_title_into(&mut same, &json!({"title": "ゴジラ"}));
        assert_eq!(same["title"], "ゴジラ");
    }

    #[test]
    fn what_is_fetched_again_is_what_changed_and_what_the_cover_does_not_reach() {
        let now = 100 * 86_400;
        let stored = [(1, now - 86_400), (2, now - 86_400), (3, now - 20 * 86_400)];
        let changed: BTreeSet<i64> = [2, 99].into_iter().collect();
        assert_eq!(due(&stored, Some(&changed), now - 10 * 86_400, 10), vec![2, 3]);
        assert_eq!(due(&stored, Some(&changed), now - 30 * 86_400, 10), vec![2], "an old row is vouched for while the cover is unbroken");
        assert_eq!(due(&stored, None, now, 10), vec![1, 2, 3], "a list too long to read vouches for nothing");
        assert_eq!(due(&stored, None, now, 1), vec![3], "a run catches up on the longest unasked first, as many as its budget");
        assert_eq!(due(&stored, Some(&changed), now, 0), vec![2], "what a list names is fetched whatever the budget");
        assert_eq!(Refresh::from_flags(true, true), Refresh::Everything);
        assert_eq!(Refresh::from_flags(true, false), Refresh::Changed);
        assert_eq!(Refresh::from_flags(false, false), Refresh::No);
    }

    #[test]
    fn a_read_starts_on_the_day_of_the_last_and_keeps_the_cover_and_a_gap_starts_it_anew() {
        let day = 86_400;
        let now = 100 * day + 4 * 3_600;
        assert_eq!(cover(Some((10 * day, now - day)), now), Cover { since: 99 * day, covered_from: 10 * day });
        assert_eq!(cover(Some((10 * day, now - 7 * day)), now), Cover { since: 93 * day, covered_from: 10 * day });
        assert_eq!(cover(Some((10 * day, now - 20 * day)), now), Cover { since: 93 * day, covered_from: 93 * day });
        assert_eq!(cover(None, now), Cover { since: 93 * day, covered_from: 93 * day });
    }
}
