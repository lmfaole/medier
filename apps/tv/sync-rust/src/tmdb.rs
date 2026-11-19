//! What the series register TMDB says about each series in the log. Each series and year is looked up once (the answer
//! is kept, found or not, so a wrong or missing match is settled by writing the register's number in the log), each
//! series' details and credits are landed unchanged under `.data/raw/tmdb/<date>/` and stored in Norwegian where the
//! register has it. The client, the search, the people and the tables are `shared_data::tmdb`, which film shares; this
//! file is what a series' answer says — the `name` of a search, `first_air_date`, `created_by` for the creators and
//! `networks` for where it was seen.

use anyhow::{Context, Result};
use serde_json::{json, Value};
use shared_data::batch::insert_statements;
use shared_data::sqlite_client::SqliteClient;
use shared_data::tmdb::{self, Credits, Pull, Register, Shape};

/// The people kept from a series' cast: its billing order, first to last.
const CAST_KEPT: usize = 12;
const CREATORS_KEPT: usize = 3;
const PRODUCERS_KEPT: usize = 4;
const KEYWORDS_KEPT: usize = 15;
const COMPANIES_KEPT: usize = 5;
/// What is kept of a series' credits: its own `created_by` creators, then the crew jobs the pages show (the first job
/// a person has in a series wins) and the first of the cast.
const CREDITS: Credits = Credits {
    jobs: &[
        ("Writer", "Writer"),
        ("Screenplay", "Writer"),
        ("Story", "Writer"),
        ("Director of Photography", "Cinematography"),
        ("Original Music Composer", "Composer"),
        ("Editor", "Editor"),
        ("Executive Producer", "Producer"),
        ("Producer", "Producer"),
    ],
    created_by: "Creator",
    creators_kept: CREATORS_KEPT,
    producers_kept: PRODUCERS_KEPT,
    cast_kept: CAST_KEPT,
};

/// The series register's tables.
pub const REGISTER: Register = Register { prefix: "tv" };

pub const PULL: Pull = Pull {
    register: REGISTER,
    shape: Shape::Series,
    search: "/search/tv",
    details: "/tv/{}",
    changes: "/tv/changes",
    append: "credits,keywords,external_ids,recommendations",
    noun: "series",
    agent: "tv-sync/0.1 (+https://sky.lmfaole.party/apps/medier/tv)",
};

pub struct Series {
    pub id: i64,
    pub title: String,
    pub original_title: Option<String>,
    pub first_air_date: Option<String>,
    pub last_air_date: Option<String>,
    pub number_of_seasons: Option<i64>,
    pub number_of_episodes: Option<i64>,
    pub episode_runtime_min: Option<i64>,
    /// What the register says about every work, film or series.
    pub work: tmdb::Work,
    pub status: Option<String>,
    pub in_production: bool,
    pub homepage: Option<String>,
    /// (network, name, country, position): where the series is shown, which the pages read as its place.
    pub networks: Vec<(i64, String, Option<String>, i64)>,
    /// The genres, countries, credits, companies and keywords kept beside the series.
    pub facets: tmdb::Facets,
}

/// A series' details answer (with `credits` appended) as the series and its people.
pub fn parse_series(answer: &Value) -> Result<Series> {
    let id = answer["id"].as_i64().context("the answer has no id")?;
    let title = tmdb::text(&answer["name"]).or_else(|| tmdb::text(&answer["original_name"])).context("the series has no name")?;
    Ok(Series {
        id,
        title,
        original_title: tmdb::text(&answer["original_name"]),
        first_air_date: tmdb::text(&answer["first_air_date"]),
        last_air_date: tmdb::text(&answer["last_air_date"]),
        number_of_seasons: tmdb::positive(&answer["number_of_seasons"]),
        number_of_episodes: tmdb::positive(&answer["number_of_episodes"]),
        episode_runtime_min: answer["episode_run_time"].as_array().into_iter().flatten().find_map(tmdb::positive),
        work: tmdb::Work::of(answer),
        status: tmdb::text(&answer["status"]),
        in_production: answer["in_production"].as_bool().unwrap_or(false),
        homepage: tmdb::text(&answer["homepage"]),
        networks: tmdb::networks_in(answer),
        facets: tmdb::facets_in(answer, &CREDITS, "results", COMPANIES_KEPT, KEYWORDS_KEPT),
    })
}

/// Replaces everything stored about a series, the networks it is shown on included.
pub fn store_series(db: &SqliteClient, series: &Series, now: i64) -> Result<()> {
    let id = json!(series.id);
    let mut batch: Vec<(String, Vec<Value>)> = vec![
        (format!("DELETE FROM {} WHERE tmdb_id = ?", REGISTER.title()), vec![id.clone()]),
        ("DELETE FROM tv_network WHERE tmdb_id = ?".to_string(), vec![id.clone()]),
    ];
    batch.extend(insert_statements(
        "INSERT INTO",
        &REGISTER.title(),
        &[
            "tmdb_id", "title", "original_title", "first_air_date", "last_air_date", "number_of_seasons", "number_of_episodes", "episode_runtime_min", "overview", "tagline", "poster_path", "backdrop_path", "original_language", "status",
            "in_production", "homepage", "fetched_at", "vote_average", "vote_count", "imdb_id", "wikidata_id",
        ],
        [vec![
            id.clone(),
            json!(series.title),
            json!(series.original_title),
            json!(series.first_air_date),
            json!(series.last_air_date),
            json!(series.number_of_seasons),
            json!(series.number_of_episodes),
            json!(series.episode_runtime_min),
            json!(series.work.overview),
            json!(series.work.tagline),
            json!(series.work.poster_path),
            json!(series.work.backdrop_path),
            json!(series.work.original_language),
            json!(series.status),
            json!(i64::from(series.in_production)),
            json!(series.homepage),
            json!(now),
            json!(series.work.vote_average),
            json!(series.work.vote_count),
            json!(series.work.imdb_id),
            json!(series.work.wikidata_id),
        ]],
    ));
    batch.extend(insert_statements(
        "INSERT OR REPLACE INTO",
        "tv_network",
        &["tmdb_id", "network_id", "name", "country", "position"],
        series.networks.iter().map(|(network, name, country, position)| vec![id.clone(), json!(network), json!(name), json!(country), json!(position)]),
    ));
    db.execute_batch(&batch).with_context(|| format!("writing what the register says about {}", series.title))?;
    tmdb::store_facets(db, &REGISTER, series.id, &series.facets)
}

/// What names the works to look up: the log of what was watched and the collection of what is owned or wanted.
const LOGS: &[&shared_data::watch_log::Log] = &[&crate::log::LOG, &crate::log::COLLECTION];

/// The `tmdb` job: find the series the log names without a number, then fetch the details of each series.
pub fn run(db: &SqliteClient, refresh: tmdb::Refresh) -> Result<()> {
    tmdb::run(db, &PULL, refresh, tmdb::unresolved(db, LOGS), |db, answer, now| store_series(db, &parse_series(answer)?, now))
}

#[cfg(test)]
mod tests {
    use super::*;
    use shared_data::tmdb::Found;

    fn search() -> Value {
        json!({"results": [
            {"id": 1, "name": "Severance", "original_name": "Severance", "first_air_date": "2022-02-18", "popularity": 90.0},
            {"id": 2, "name": "Severance", "original_name": "Severance", "first_air_date": "2006-01-01", "popularity": 5.0},
            {"id": 3, "name": "The Bear", "original_name": "The Bear", "first_air_date": "2022-06-23", "popularity": 60.0}
        ]})
    }

    fn series_answer() -> Value {
        json!({
            "id": 95396, "name": "Severance", "original_name": "Severance", "first_air_date": "2022-02-18", "last_air_date": "2025-03-20",
            "number_of_seasons": 2, "number_of_episodes": 19, "episode_run_time": [0, 48], "overview": " A team. ", "tagline": "", "poster_path": "/p.jpg",
            "original_language": "en", "status": "Returning Series", "in_production": true, "homepage": "https://tv.apple.com/severance",
            "genres": [{"id": 18, "name": "Drama"}, {"id": 9648, "name": "Mysterium"}],
            "production_countries": [{"iso_3166_1": "US", "name": "USA"}],
            "created_by": [{"id": 1, "name": "Dan Erickson"}],
            "networks": [{"id": 2552, "name": "Apple TV+", "origin_country": "US"}, {"id": 2, "name": "", "origin_country": "US"}],
            "credits": {"cast": [{"id": 1158, "name": "Adam Scott", "character": "Mark"}, {"id": 380, "name": "Britt Lower", "character": "Helly"}],
                        "crew": [{"id": 1, "name": "Dan Erickson", "job": "Writer"}, {"id": 9, "name": "Someone", "job": "Gaffer"}, {"id": 7, "name": "Theodore Shapiro", "job": "Original Music Composer"}]},
            "vote_average": 8.4, "vote_count": 1200, "external_ids": {"imdb_id": "tt11280740", "wikidata_id": "Q105699929"},
            "production_companies": [{"name": "Red Hour", "origin_country": "US"}, {"name": "", "origin_country": ""}],
            "keywords": {"results": [{"id": 1, "name": "office"}, {"id": 2, "name": "  "}]}
        })
    }

    fn db() -> SqliteClient {
        shared_data::app_db::memory_with_schema(crate::schema::SCHEMA)
    }

    #[test]
    fn a_series_is_the_hit_with_the_name_and_the_first_air_year() {
        assert_eq!(tmdb::pick(&search(), "severance", 2022, Shape::Series), Found::Number(1));
        assert_eq!(tmdb::pick(&search(), "The Bear", 0, Shape::Series), Found::Number(3));
    }

    #[test]
    fn a_series_has_its_creators_its_networks_and_the_first_of_its_cast() {
        let series = parse_series(&series_answer()).unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!((series.title.as_str(), series.episode_runtime_min, series.work.overview.as_deref(), series.work.tagline), ("Severance", Some(48), Some("A team."), None));
        assert_eq!((series.number_of_seasons, series.number_of_episodes, series.status.as_deref(), series.in_production), (Some(2), Some(19), Some("Returning Series"), true));
        assert_eq!(series.networks, vec![(2552, "Apple TV+".to_string(), Some("US".to_string()), 0)]);
        assert_eq!(
            series.facets.credits.iter().map(|credit| (credit.2.as_str(), credit.1.as_str(), credit.3.as_deref(), credit.4)).collect::<Vec<_>>(),
            vec![("Creator", "Dan Erickson", None, 0), ("Writer", "Dan Erickson", None, 1), ("Composer", "Theodore Shapiro", None, 2), ("Cast", "Adam Scott", Some("Mark"), 0), ("Cast", "Britt Lower", Some("Helly"), 1)]
        );
        assert!(parse_series(&json!({"id": 1})).is_err());
    }

    #[test]
    fn a_series_has_its_rating_ids_companies_keywords_and_its_genres() {
        let series = parse_series(&series_answer()).unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!((series.work.vote_average, series.work.vote_count), (Some(8.4), Some(1200)));
        assert_eq!((series.work.imdb_id.as_deref(), series.work.wikidata_id.as_deref()), (Some("tt11280740"), Some("Q105699929")));
        assert_eq!((series.facets.genres.clone(), series.facets.countries.clone(), series.facets.keywords.clone()), (vec!["Drama".to_string(), "Mysterium".to_string()], vec![("US".to_string(), "USA".to_string())], vec!["office".to_string()]));
        assert_eq!(series.facets.companies, vec![("Red Hour".to_string(), Some("US".to_string()))]);
    }

    #[test]
    fn storing_a_series_twice_leaves_one_copy_and_what_is_wanted_is_what_has_no_details_yet() {
        let db = db();
        let series = parse_series(&series_answer()).unwrap_or_else(|error| panic!("{error:#}"));
        store_series(&db, &series, 1).unwrap_or_else(|error| panic!("{error:#}"));
        store_series(&db, &series, 2).unwrap_or_else(|error| panic!("{error:#}"));
        let count = |table: &str| db.query(&format!("SELECT count(*) AS n FROM {table}"), &[]).unwrap_or_default()[0]["n"].as_i64();
        assert_eq!([count("tv_title"), count("tv_genre"), count("tv_network"), count("tv_credit")], [Some(1), Some(2), Some(1), Some(5)]);
        assert_eq!(tmdb::people_wanted(&db, &REGISTER, false).unwrap_or_default(), vec![1, 7, 380, 1158]);
        db.execute("INSERT INTO tv_watch (watched_on, series, year, rewatch, tmdb_id) VALUES ('2026-01-01', 'Severance', 2022, 0, 95396), ('2026-01-02', 'New', 2020, 0, 12)", &[]).unwrap_or_else(|error| panic!("{error}"));
        tmdb::store_match(&db, &REGISTER, "The Bear", 2022, &Found::Number(3), 1).unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!(tmdb::wanted(&db, &REGISTER, false).unwrap_or_default(), vec![3, 12]);
        assert_eq!(tmdb::wanted(&db, &REGISTER, true).unwrap_or_default(), vec![3, 12, 95396]);
    }

    #[test]
    fn a_series_already_searched_for_is_not_searched_for_again_unless_asked() {
        let db = db();
        db.execute("INSERT INTO tv_watch (watched_on, series, year, rewatch) VALUES ('2026-01-01', 'Severance', 2022, 0), ('2026-01-02', 'Dark', NULL, 0)", &[]).unwrap_or_else(|error| panic!("{error}"));
        tmdb::store_match(&db, &REGISTER, "Severance", 2022, &Found::Candidates(vec![]), 1).unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!(tmdb::unsearched(&db, &REGISTER, false, tmdb::unresolved(&db, LOGS)), vec![("Dark".to_string(), 0)]);
        assert_eq!(tmdb::unsearched(&db, &REGISTER, true, tmdb::unresolved(&db, LOGS)).len(), 2);
    }
}
