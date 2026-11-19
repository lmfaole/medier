//! The franchises the films belong to: for each `collection_id` of `film_title`, TMDB's collection with every part of it and the
//! day each came out (`film-sync franchises`). A page can then say how much of a franchise has been seen. The answers are landed
//! unchanged under `.data/raw/tmdb/<date>/`, and a franchise fetched in the last week is not asked for again.

use anyhow::{Context, Result};
use serde_json::{json, Value};
use shared_data::batch::insert_statements;
use shared_data::sqlite_client::SqliteClient;
use shared_data::tmdb::{self, Client};

/// A franchise is asked for again after this many days.
const FRESH_DAYS: i64 = 6;

const FRANCHISES_WANTED: &str = "SELECT DISTINCT t.collection_id AS id FROM film_title AS t LEFT JOIN film_franchise AS f ON f.franchise_id = t.collection_id \
    WHERE t.collection_id IS NOT NULL AND (f.fetched_at IS NULL OR f.fetched_at < ?) ORDER BY t.collection_id";

/// What `--everything` asks for: every franchise, whenever it was fetched.
const ALL: i64 = i64::MAX;

#[derive(Debug, Clone, PartialEq)]
pub struct Part {
    pub id: i64,
    pub title: String,
    pub day: Option<String>,
    pub poster_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Franchise {
    pub id: i64,
    pub name: String,
    pub overview: Option<String>,
    pub poster_path: Option<String>,
    pub backdrop_path: Option<String>,
    /// By release day, the first part first; a part with no day comes last.
    pub parts: Vec<Part>,
}

/// A name with no Latin letter is the original's (the register had no Norwegian one): worth asking for in English.
fn has_latin(name: &str) -> bool {
    name.chars().any(|letter| letter.is_ascii_alphabetic())
}

pub fn parse_franchise(answer: &Value) -> Result<Franchise> {
    let id = answer["id"].as_i64().context("the answer has no id")?;
    let name = tmdb::text(&answer["name"]).context("the franchise has no name")?;
    let mut parts: Vec<Part> = answer["parts"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|part| Some(Part { id: part["id"].as_i64()?, title: tmdb::text(&part["title"])?, day: tmdb::text(&part["release_date"]), poster_path: tmdb::text(&part["poster_path"]) }))
        .collect();
    parts.sort_by(|a, b| (a.day.is_none(), &a.day, a.id).cmp(&(b.day.is_none(), &b.day, b.id)));
    Ok(Franchise { id, name, overview: tmdb::text(&answer["overview"]), poster_path: tmdb::text(&answer["poster_path"]), backdrop_path: tmdb::text(&answer["backdrop_path"]), parts })
}

/// Replaces everything stored about a franchise.
pub fn store_franchise(db: &SqliteClient, franchise: &Franchise, now: i64) -> Result<()> {
    let id = json!(franchise.id);
    let mut batch: Vec<(String, Vec<Value>)> = vec![("DELETE FROM film_franchise_part WHERE franchise_id = ?".to_string(), vec![id.clone()]), ("DELETE FROM film_franchise WHERE franchise_id = ?".to_string(), vec![id.clone()])];
    batch.extend(insert_statements(
        "INSERT INTO",
        "film_franchise",
        &["franchise_id", "name", "overview", "poster_path", "fetched_at", "backdrop_path"],
        [vec![id.clone(), json!(franchise.name), json!(franchise.overview), json!(franchise.poster_path), json!(now), json!(franchise.backdrop_path)]],
    ));
    batch.extend(insert_statements(
        "INSERT OR IGNORE INTO",
        "film_franchise_part",
        &["franchise_id", "tmdb_id", "title", "day", "poster_path", "position"],
        franchise.parts.iter().enumerate().map(|(position, part)| vec![id.clone(), json!(part.id), json!(part.title), json!(part.day), json!(part.poster_path), json!(position)]),
    ));
    db.execute_batch(&batch).with_context(|| format!("writing the franchise {}", franchise.name))
}

/// The `franchises` job: every franchise a film belongs to that has not been fetched this week (`--everything`: all of them again).
pub fn run(db: &SqliteClient, everything: bool) -> Result<()> {
    let now = chrono::Utc::now().timestamp();
    let wanted: Vec<i64> = db.query(FRANCHISES_WANTED, &[json!(if everything { ALL } else { now - FRESH_DAYS * 86_400 })])?.iter().filter_map(|row| row["id"].as_i64()).collect();
    if wanted.is_empty() {
        println!("franchises: none to fetch");
        return Ok(());
    }
    let client = Client::new("film-sync/0.1 (+https://sky.lmfaole.party/apps/medier/film)")?;
    let directory = shared_data::raw::landing_path("tmdb", chrono::Utc::now().date_naive())?;
    std::fs::create_dir_all(&directory).with_context(|| format!("creating {}", directory.display()))?;
    for id in &wanted {
        let Some(mut answer) = client.get_optional(&format!("/collection/{id}"), &[("language", "no-NO")])? else { continue };
        tmdb::land(&directory.join(format!("collection-{id}.json")), &answer)?;
        if !tmdb::text(&answer["name"]).is_some_and(|name| has_latin(&name)) {
            if let Some(english) = client.get_optional(&format!("/collection/{id}"), &[("language", "en-US")])? {
                answer["name"] = english["name"].clone();
            }
        }
        store_franchise(db, &parse_franchise(&answer)?, now)?;
    }
    println!("franchises: {} fetched", wanted.len());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn answer() -> Value {
        json!({"id": 5, "name": "Heat-samlingen", "overview": " Two. ", "poster_path": "/h.jpg", "backdrop_path": "/b.jpg", "parts": [
            {"id": 12, "title": "Heat 2", "release_date": "", "poster_path": null},
            {"id": 11, "title": "Heat", "release_date": "1995-12-15", "poster_path": "/a.jpg"},
            {"id": 13, "title": "Heat 1.5", "release_date": "2001-01-01"}
        ]})
    }

    #[test]
    fn the_parts_come_by_release_day_with_the_unreleased_last() {
        let franchise = parse_franchise(&answer()).unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!(franchise.parts.iter().map(|part| part.id).collect::<Vec<_>>(), vec![11, 13, 12]);
        assert_eq!((franchise.name.as_str(), franchise.overview.as_deref(), franchise.parts[2].day.as_deref(), franchise.backdrop_path.as_deref()), ("Heat-samlingen", Some("Two."), None, Some("/b.jpg")));
        assert!(parse_franchise(&json!({"id": 1})).is_err());
    }

    #[test]
    fn a_franchise_is_stored_once_and_a_name_with_no_latin_letter_is_asked_for_in_english() {
        let db = shared_data::app_db::memory_with_schema(crate::schema::SCHEMA);
        let franchise = parse_franchise(&answer()).unwrap_or_else(|error| panic!("{error:#}"));
        store_franchise(&db, &franchise, 1).unwrap_or_else(|error| panic!("{error:#}"));
        store_franchise(&db, &franchise, 2).unwrap_or_else(|error| panic!("{error:#}"));
        let count = |table: &str| db.query(&format!("SELECT count(*) AS n FROM {table}"), &[]).unwrap_or_default()[0]["n"].as_i64();
        assert_eq!([count("film_franchise"), count("film_franchise_part")], [Some(1), Some(3)]);
        assert!(has_latin("Pokémon Collection") && !has_latin("ポケットモンスター シリーズ"));
    }
}
