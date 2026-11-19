//! What the film register TMDB says about each film in the log. Each title and year is looked up once (the
//! answer is kept, found or not, so a wrong or missing match is settled by writing the register's number in the
//! log), each film's details and credits are landed unchanged under `.data/raw/tmdb/<date>/` and stored in Norwegian
//! where the register has it. The client, the search, the people and the tables are `shared_data::tmdb`, which TV
//! shares; this file is what a film's answer says.

use anyhow::{Context, Result};
use serde_json::{json, Value};
use shared_data::batch::insert_statements;
use shared_data::sqlite_client::SqliteClient;
use shared_data::tmdb::{self, Credits, Pull, Register, Shape};

/// The people kept from a film's cast: its billing order, first to last.
const CAST_KEPT: usize = 15;
const PRODUCERS_KEPT: usize = 4;
const KEYWORDS_KEPT: usize = 15;
const COMPANIES_KEPT: usize = 5;
/// What is kept of a film's credits: the crew jobs the pages show (the first job a person has wins) and the first of
/// the cast. A film has no `created_by` list; its creators are the directors.
const CREDITS: Credits = Credits {
    jobs: &[
        ("Director", "Director"),
        ("Screenplay", "Writer"),
        ("Writer", "Writer"),
        ("Story", "Writer"),
        ("Director of Photography", "Cinematography"),
        ("Original Music Composer", "Composer"),
        ("Editor", "Editor"),
        ("Producer", "Producer"),
    ],
    created_by: "",
    creators_kept: 0,
    producers_kept: PRODUCERS_KEPT,
    cast_kept: CAST_KEPT,
};

/// The film register's tables.
pub const REGISTER: Register = Register { prefix: "film" };

pub const PULL: Pull = Pull {
    register: REGISTER,
    shape: Shape::Film,
    search: "/search/movie",
    details: "/movie/{}",
    changes: "/movie/changes",
    append: "credits,keywords,release_dates,external_ids,recommendations",
    noun: "films",
    agent: "film-sync/0.1 (+https://sky.lmfaole.party/apps/medier/film)",
};

#[derive(Debug, Clone, PartialEq)]
pub struct Film {
    pub id: i64,
    pub title: String,
    pub original_title: Option<String>,
    pub release_date: Option<String>,
    pub runtime_min: Option<i64>,
    /// What the register says about every work, film or series.
    pub work: tmdb::Work,
    pub budget: Option<i64>,
    pub revenue: Option<i64>,
    /// The Norwegian age rating and the day of the Norwegian release.
    pub certification: Option<String>,
    pub released_no: Option<String>,
    pub collection: Option<(i64, String)>,
    /// The genres, countries, credits, companies and keywords kept beside the film.
    pub facets: tmdb::Facets,
}

/// The age rating and day of the Norwegian release among a film's `release_dates`: the cinema release when there is one.
fn norwegian_release(answer: &Value) -> (Option<String>, Option<String>) {
    let dates: Vec<&Value> = answer["release_dates"]["results"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|country| country["iso_3166_1"] == "NO")
        .flat_map(|country| country["release_dates"].as_array().into_iter().flatten())
        .collect();
    let certification = dates.iter().find_map(|date| tmdb::text(&date["certification"]));
    let released = dates.iter().filter(|date| date["type"].as_i64() == Some(3)).chain(dates.iter()).find_map(|date| tmdb::text(&date["release_date"]).and_then(|day| day.get(..10).map(str::to_string)));
    (certification, released)
}

/// A film's details answer (with `credits` appended) as the film and its people.
pub fn parse_film(answer: &Value) -> Result<Film> {
    let id = answer["id"].as_i64().context("the answer has no id")?;
    let title = tmdb::text(&answer["title"]).or_else(|| tmdb::text(&answer["original_title"])).context("the film has no title")?;
    let (certification, released_no) = norwegian_release(answer);
    Ok(Film {
        id,
        title,
        original_title: tmdb::text(&answer["original_title"]),
        release_date: tmdb::text(&answer["release_date"]),
        runtime_min: answer["runtime"].as_i64().filter(|minutes| *minutes > 0),
        work: tmdb::Work::of(answer),
        budget: tmdb::positive(&answer["budget"]),
        revenue: tmdb::positive(&answer["revenue"]),
        certification,
        released_no,
        collection: answer["belongs_to_collection"]["id"].as_i64().zip(tmdb::text(&answer["belongs_to_collection"]["name"])),
        facets: tmdb::facets_in(answer, &CREDITS, "keywords", COMPANIES_KEPT, KEYWORDS_KEPT),
    })
}

/// Replaces everything stored about a film.
pub fn store_film(db: &SqliteClient, film: &Film, now: i64) -> Result<()> {
    let id = json!(film.id);
    let mut batch: Vec<(String, Vec<Value>)> = vec![(format!("DELETE FROM {} WHERE tmdb_id = ?", REGISTER.title()), vec![id.clone()])];
    batch.extend(insert_statements(
        "INSERT INTO",
        &REGISTER.title(),
        &[
            "tmdb_id", "title", "original_title", "release_date", "runtime_min", "overview", "tagline", "poster_path", "backdrop_path", "original_language", "fetched_at", "vote_average", "vote_count", "budget", "revenue", "imdb_id",
            "wikidata_id", "certification", "released_no", "collection_id", "collection",
        ],
        [vec![
            id.clone(),
            json!(film.title),
            json!(film.original_title),
            json!(film.release_date),
            json!(film.runtime_min),
            json!(film.work.overview),
            json!(film.work.tagline),
            json!(film.work.poster_path),
            json!(film.work.backdrop_path),
            json!(film.work.original_language),
            json!(now),
            json!(film.work.vote_average),
            json!(film.work.vote_count),
            json!(film.budget),
            json!(film.revenue),
            json!(film.work.imdb_id),
            json!(film.work.wikidata_id),
            json!(film.certification),
            json!(film.released_no),
            json!(film.collection.as_ref().map(|(id, _)| id)),
            json!(film.collection.as_ref().map(|(_, name)| name)),
        ]],
    ));
    db.execute_batch(&batch).with_context(|| format!("writing what the register says about {}", film.title))?;
    tmdb::store_facets(db, &REGISTER, film.id, &film.facets)
}

/// What names the works to look up: the log of what was watched and the collection of what is owned or wanted.
const LOGS: &[&shared_data::watch_log::Log] = &[&crate::log::LOG, &crate::log::COLLECTION];

/// The `tmdb` job: find the films the log names without a number, then fetch the details of each film.
pub fn run(db: &SqliteClient, refresh: tmdb::Refresh) -> Result<()> {
    tmdb::run(db, &PULL, refresh, tmdb::unresolved(db, LOGS), |db, answer, now| store_film(db, &parse_film(answer)?, now))
}

#[cfg(test)]
mod tests {
    use super::*;
    use shared_data::tmdb::Found;

    fn search() -> Value {
        json!({"results": [
            {"id": 1, "title": "Heat", "original_title": "Heat", "release_date": "1995-12-15", "popularity": 50.0},
            {"id": 2, "title": "Heat", "original_title": "Heat", "release_date": "1986-01-01", "popularity": 5.0},
            {"id": 3, "title": "Heat Wave", "original_title": "Heat Wave", "release_date": "1995-01-01", "popularity": 90.0},
            {"id": 4, "title": "Sult", "original_title": "Hunger", "release_date": "2008-10-31", "popularity": 20.0}
        ]})
    }

    fn film_answer() -> Value {
        json!({
            "id": 949, "title": "Heat", "original_title": "Heat", "release_date": "1995-12-15", "runtime": 170, "overview": " A crew. ", "tagline": "", "poster_path": "/p.jpg",
            "original_language": "en", "genres": [{"id": 28, "name": "Action"}, {"id": 80, "name": "Krim"}],
            "production_countries": [{"iso_3166_1": "US", "name": "USA"}],
            "credits": {"cast": [{"id": 1158, "name": "Al Pacino", "character": "Vincent Hanna"}, {"id": 380, "name": "Robert De Niro", "character": "Neil McCauley"}],
                        "crew": [{"id": 1, "name": "Someone", "job": "Gaffer"}, {"id": 1100, "name": "Michael Mann", "job": "Director"}, {"id": 1100, "name": "Michael Mann", "job": "Screenplay"},
                                 {"id": 7, "name": "Elliot Goldenthal", "job": "Original Music Composer"}]},
            "vote_average": 7.9, "vote_count": 1200, "budget": 60_000_000, "revenue": 0, "imdb_id": "tt0113277",
            "external_ids": {"wikidata_id": "Q221103"}, "belongs_to_collection": {"id": 5, "name": "Heat-samlingen"},
            "production_companies": [{"name": "Regency", "origin_country": "US"}, {"name": "", "origin_country": ""}],
            "keywords": {"keywords": [{"id": 1, "name": "heist"}, {"id": 2, "name": "  "}]},
            "release_dates": {"results": [
                {"iso_3166_1": "US", "release_dates": [{"certification": "R", "type": 3, "release_date": "1995-12-15T00:00:00.000Z"}]},
                {"iso_3166_1": "NO", "release_dates": [{"certification": "", "type": 4, "release_date": "1996-06-01T00:00:00.000Z"}, {"certification": "15", "type": 3, "release_date": "1996-02-09T00:00:00.000Z"}]}
            ]}
        })
    }

    fn db() -> SqliteClient {
        shared_data::app_db::memory_with_schema(crate::schema::SCHEMA)
    }

    #[test]
    fn the_film_is_the_hit_with_the_title_and_the_year_and_the_original_title_counts() {
        assert_eq!(tmdb::pick(&search(), "heat", 1995, Shape::Film), Found::Number(1));
        assert_eq!(tmdb::pick(&search(), "Hunger", 2008, Shape::Film), Found::Number(4));
        assert_eq!(tmdb::pick(&search(), "Heat", 0, Shape::Film), Found::Number(1));
    }

    #[test]
    fn a_title_nobody_matches_gives_the_first_candidates_to_choose_from() {
        match tmdb::pick(&search(), "Heat", 2001, Shape::Film) {
            Found::Candidates(hits) => assert_eq!(hits.iter().map(|hit| hit.id).collect::<Vec<_>>(), vec![1, 2, 3, 4]),
            other @ Found::Number(_) => panic!("{other:?}"),
        }
    }

    #[test]
    fn a_film_has_its_directors_and_the_first_of_its_cast_and_empty_text_is_none() {
        let film = parse_film(&film_answer()).unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!((film.title.as_str(), film.runtime_min, film.work.overview.as_deref(), film.work.tagline), ("Heat", Some(170), Some("A crew."), None));
        assert_eq!(film.facets.genres, vec!["Action", "Krim"]);
        assert_eq!(film.facets.countries, vec![("US".to_string(), "USA".to_string())]);
        assert_eq!(film.facets.credits.iter().map(|credit| (credit.2.as_str(), credit.1.as_str(), credit.4)).collect::<Vec<_>>(), vec![("Director", "Michael Mann", 0), ("Writer", "Michael Mann", 1), ("Composer", "Elliot Goldenthal", 2), ("Cast", "Al Pacino", 0), ("Cast", "Robert De Niro", 1)]);
        assert!(parse_film(&json!({"id": 1})).is_err());
    }

    #[test]
    fn a_film_has_its_ratings_money_ids_series_companies_keywords_and_the_norwegian_release() {
        let film = parse_film(&film_answer()).unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!((film.work.vote_average, film.work.vote_count, film.budget, film.revenue), (Some(7.9), Some(1200), Some(60_000_000), None));
        assert_eq!((film.work.imdb_id.as_deref(), film.work.wikidata_id.as_deref(), film.collection), (Some("tt0113277"), Some("Q221103"), Some((5, "Heat-samlingen".to_string()))));
        assert_eq!((film.facets.companies.clone(), film.facets.keywords.clone()), (vec![("Regency".to_string(), Some("US".to_string()))], vec!["heist".to_string()]));
        assert_eq!((film.certification.as_deref(), film.released_no.as_deref()), (Some("15"), Some("1996-02-09")));
    }

    #[test]
    fn a_person_is_stored_once_and_wanted_until_stored() {
        let db = db();
        let film = parse_film(&film_answer()).unwrap_or_else(|error| panic!("{error:#}"));
        store_film(&db, &film, 1).unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!(tmdb::people_wanted(&db, &REGISTER, false).unwrap_or_default(), vec![7, 380, 1100, 1158]);
        let person = tmdb::parse_person(&json!({"id": 1100, "name": "Michael Mann", "birthday": "1943-02-05", "biography": " ", "known_for_department": "Directing"})).unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!((person.birthday.as_deref(), person.biography.as_deref()), (Some("1943-02-05"), None));
        tmdb::store_person(&db, &REGISTER, &person, "nb", 1).unwrap_or_else(|error| panic!("{error:#}"));
        tmdb::store_person(&db, &REGISTER, &person, "nb", 2).unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!(tmdb::people_wanted(&db, &REGISTER, false).unwrap_or_default(), vec![7, 380, 1158]);
        assert_eq!(tmdb::people_wanted(&db, &REGISTER, true).unwrap_or_default().len(), 4);
    }

    #[test]
    fn storing_a_film_twice_leaves_one_copy_and_what_is_wanted_is_what_has_no_details_yet() {
        let db = db();
        let film = parse_film(&film_answer()).unwrap_or_else(|error| panic!("{error:#}"));
        store_film(&db, &film, 1).unwrap_or_else(|error| panic!("{error:#}"));
        store_film(&db, &film, 2).unwrap_or_else(|error| panic!("{error:#}"));
        let count = |table: &str| db.query(&format!("SELECT count(*) AS n FROM {table}"), &[]).unwrap_or_default()[0]["n"].as_i64();
        assert_eq!([count("film_title"), count("film_genre"), count("film_country"), count("film_credit")], [Some(1), Some(2), Some(1), Some(5)]);
        db.execute("INSERT INTO film_watch (watched_on, title, year, rewatch, tmdb_id) VALUES ('2026-01-01', 'Heat', 1995, 0, 949), ('2026-01-02', 'New', 2020, 0, 12)", &[]).unwrap_or_else(|error| panic!("{error}"));
        tmdb::store_match(&db, &REGISTER, "Hunger", 2008, &Found::Number(4), 1).unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!(tmdb::wanted(&db, &REGISTER, false).unwrap_or_default(), vec![4, 12]);
        assert_eq!(tmdb::wanted(&db, &REGISTER, true).unwrap_or_default(), vec![4, 12, 949]);
    }

    #[test]
    fn a_title_already_searched_for_is_not_searched_for_again_unless_asked() {
        let db = db();
        db.execute("INSERT INTO film_watch (watched_on, title, year, rewatch) VALUES ('2026-01-01', 'Heat', 1995, 0), ('2026-01-02', 'Alien', NULL, 0)", &[]).unwrap_or_else(|error| panic!("{error}"));
        tmdb::store_match(&db, &REGISTER, "Heat", 1995, &Found::Candidates(vec![]), 1).unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!(tmdb::unsearched(&db, &REGISTER, false, tmdb::unresolved(&db, LOGS)), vec![("Alien".to_string(), 0)]);
        assert_eq!(tmdb::unsearched(&db, &REGISTER, true, tmdb::unresolved(&db, LOGS)).len(), 2);
    }
}
