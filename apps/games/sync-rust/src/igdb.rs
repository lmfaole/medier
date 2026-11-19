//! The register IGDB (owned by Twitch): the search that finds a game by title, and the game's facts (developer, first
//! release, genres, summary, cover). It is asked with a Twitch application's id and secret (`IGDB_CLIENT_ID`,
//! `IGDB_CLIENT_SECRET`, from dev.twitch.tv/console), which buy a short-lived token at the start of every run.

use std::collections::BTreeSet;
use std::time::Duration;

use anyhow::{Context, Result};
use chrono::{DateTime, Datelike};
use serde_json::{json, Value};
use shared_data::shelf::{http, landing, now, web_address, Hit, Item, Session};
use shared_data::text::slug;
use shared_data::tmdb::{land, text};

const TOKEN: &str = "https://id.twitch.tv/oauth2/token";
const GAMES: &str = "https://api.igdb.com/v4/games";
const TIMES: &str = "https://api.igdb.com/v4/game_time_to_beats";
const COMPANIES: &str = "https://api.igdb.com/v4/companies";
const DEVELOPERS: &str = "SELECT creator FROM game_item WHERE creator IS NOT NULL";
const KNOWN_COMPANIES: &str = "SELECT name FROM game_company";
/// IGDB allows four calls a second.
const PAUSE: Duration = Duration::from_millis(300);
/// How many games one request about their facets or their times names.
const BATCH: usize = 100;
const FACET_FIELDS: &str = "platforms.name,game_modes.name,themes.name,player_perspectives.name,collections.name";
const KNOWN_FACETS: &str = "SELECT DISTINCT ext_id FROM game_time_to_beat";
const ALL_ITEMS: &str = "SELECT ext_id FROM game_item ORDER BY ext_id";
const FIELDS: &str = "name,first_release_date,summary,url,genres.name,cover.image_id,screenshots.image_id,artworks.image_id,involved_companies.developer,involved_companies.company.name";

/// A title as an IGDB query writes a string.
fn quoted(title: &str) -> String {
    format!("\"{}\"", title.replace('\\', "").replace('"', "\\\""))
}

/// The year of a release date given in seconds.
fn year_of(seconds: &Value) -> Option<i64> {
    let at = DateTime::from_timestamp(seconds.as_i64()?, 0)?;
    Some(i64::from(at.year()))
}

/// The hits of a search; the games others have rated most are the likeliest ones.
fn hits_in(answer: &Value) -> Vec<Hit> {
    answer
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|game| Some(Hit { ext_id: game["id"].as_i64()?.to_string(), title: text(&game["name"])?, year: year_of(&game["first_release_date"]), popularity: game["total_rating_count"].as_f64().unwrap_or_default() }))
        .collect()
}

/// The developers of a game, or its first company when none is marked as one.
fn developers_in(game: &Value) -> Option<String> {
    let companies: Vec<&Value> = game["involved_companies"].as_array().into_iter().flatten().collect();
    let companies_named = |marked: bool| companies.iter().filter(|company| !marked || company["developer"] == true).filter_map(|company| text(&company["company"]["name"])).collect::<Vec<_>>();
    let developers = companies_named(true);
    let listed = if developers.is_empty() { companies_named(false).into_iter().take(1).collect() } else { developers };
    (!listed.is_empty()).then(|| listed.join(", "))
}

/// A game's wide picture: its first screenshot, or else its first piece of artwork.
fn banner_of(game: &Value) -> Option<String> {
    let image = |field: &str| game[field].as_array().into_iter().flatten().find_map(|picture| picture["image_id"].as_str());
    let id = image("screenshots").or_else(|| image("artworks"))?;
    web_address(&format!("https://images.igdb.com/igdb/image/upload/t_1080p/{id}.jpg"))
}

fn item_of(game: &Value) -> Option<Item> {
    Some(Item {
        ext_id: game["id"].as_i64()?.to_string(),
        title: text(&game["name"])?,
        creator: developers_in(game),
        year: year_of(&game["first_release_date"]),
        summary: text(&game["summary"]),
        cover: game["cover"]["image_id"].as_str().and_then(|id| web_address(&format!("https://images.igdb.com/igdb/image/upload/t_cover_big/{id}.jpg"))),
        banner: banner_of(game),
        url: game["url"].as_str().and_then(web_address),
        genres: game["genres"].as_array().into_iter().flatten().filter_map(|genre| text(&genre["name"])).collect(),
    })
}

struct Client {
    http: reqwest::blocking::Client,
    id: String,
    token: String,
}

impl Client {
    fn new() -> Result<Self> {
        let id = std::env::var("IGDB_CLIENT_ID").context("IGDB_CLIENT_ID is not set: make a Twitch application at dev.twitch.tv/console and put its id in the environment of the job")?;
        let secret = std::env::var("IGDB_CLIENT_SECRET").context("IGDB_CLIENT_SECRET is not set: the secret of the Twitch application")?;
        let http = http("games-sync (lmfaole.party; hei@lmfaole.party)")?;
        let answer: Value = http
            .post(TOKEN)
            .query(&[("client_id", id.as_str()), ("client_secret", secret.as_str()), ("grant_type", "client_credentials")])
            .send()
            .and_then(reqwest::blocking::Response::error_for_status)
            .context("asking Twitch for a token")?
            .json()
            .context("reading Twitch's answer")?;
        let token = text(&answer["access_token"]).context("Twitch's answer has no access_token")?;
        Ok(Self { http, id, token })
    }

    fn games(&self, query: &str) -> Result<Value> {
        self.ask(GAMES, query)
    }

    fn ask(&self, address: &str, query: &str) -> Result<Value> {
        let answer = self
            .http
            .post(address)
            .header("Client-ID", &self.id)
            .bearer_auth(&self.token)
            .body(query.to_string())
            .send()
            .and_then(reqwest::blocking::Response::error_for_status)
            .with_context(|| format!("asking {address}"))?
            .json()
            .context("reading IGDB's answer")?;
        std::thread::sleep(PAUSE);
        Ok(answer)
    }
}

/// The address of a company's logo from its `image_id`: the medium size, a transparent PNG.
fn logo_of(company: &Value) -> Option<String> {
    company["logo"]["image_id"].as_str().and_then(|id| web_address(&format!("https://images.igdb.com/igdb/image/upload/t_logo_med/{id}.png")))
}

/// Every developer name a stored game has, once each, the ones with no row yet first asked for.
fn developers_missing(session: &Session, everything: bool) -> Result<Vec<String>> {
    let known: BTreeSet<String> = if everything { BTreeSet::new() } else { session.db.query(KNOWN_COMPANIES, &[])?.iter().filter_map(|row| row["name"].as_str().map(str::to_string)).collect() };
    let names: BTreeSet<String> = session.db.query(DEVELOPERS, &[])?.iter().filter_map(|row| row["creator"].as_str()).flat_map(|creators| creators.split(", ").map(str::to_string).collect::<Vec<_>>()).collect();
    Ok(names.difference(&known).cloned().collect())
}

/// Asks the register for the logo of each developer: a row for each, with none where the register has no logo.
fn keep_logos(client: &Client, session: &Session, directory: &std::path::Path, everything: bool) -> Result<()> {
    let names = developers_missing(session, everything)?;
    let mut with_logo = 0;
    for name in &names {
        let answer = client.ask(COMPANIES, &format!("fields name,logo.image_id; where name = {}; limit 1;", quoted(name)))?;
        land(&directory.join(format!("company-{}.json", slug(name))), &answer)?;
        let logo = logo_of(&answer[0]);
        with_logo += usize::from(logo.is_some());
        session.db.execute("INSERT OR REPLACE INTO game_company (name, logo, fetched_at) VALUES (?, ?, ?)", &[json!(name), json!(logo), json!(now())])?;
    }
    println!("logos: {} developers asked, {with_logo} with a logo", names.len());
    Ok(())
}

/// The facets of a game as `(kind, name)` rows: where it was released, how it is played, what it is about and its series.
fn facets_in(game: &Value) -> Vec<(&'static str, String)> {
    [("platform", "platforms"), ("mode", "game_modes"), ("theme", "themes"), ("perspective", "player_perspectives"), ("series", "collections")]
        .into_iter()
        .flat_map(|(kind, field)| game[field].as_array().into_iter().flatten().filter_map(move |entry| text(&entry["name"]).map(|name| (kind, name))))
        .collect()
}

fn hours(seconds: &Value) -> Option<f64> {
    seconds.as_f64().filter(|seconds| *seconds > 0.0).map(|seconds| (seconds / 360.0).round() / 10.0)
}

/// A game's times in hours: quickly, at an ordinary pace, everything.
type Times = (Option<f64>, Option<f64>, Option<f64>);

/// IGDB's times for one game, by the game's number: the first answer of each game, in hours.
fn times_in(answer: &Value) -> std::collections::BTreeMap<i64, Times> {
    let mut found = std::collections::BTreeMap::new();
    for row in answer.as_array().into_iter().flatten() {
        if let Some(game) = row["game_id"].as_i64() {
            found.entry(game).or_insert_with(|| (hours(&row["hastily"]), hours(&row["normally"]), hours(&row["completely"])));
        }
    }
    found
}

/// Asks for the facets and the times of the games that have none yet (every game with `everything`), a hundred at a time.
fn keep_facets(client: &Client, session: &Session, directory: &std::path::Path, everything: bool) -> Result<()> {
    let known: BTreeSet<String> = if everything { BTreeSet::new() } else { session.db.query(KNOWN_FACETS, &[])?.iter().filter_map(|row| row["ext_id"].as_str().map(str::to_string)).collect() };
    let ids: Vec<i64> = session.db.query(ALL_ITEMS, &[])?.iter().filter_map(|row| row["ext_id"].as_str()).filter(|id| !known.contains(*id)).filter_map(|id| id.parse().ok()).collect();
    let (mut facet_count, mut with_times) = (0, 0);
    for batch in ids.chunks(BATCH) {
        let list = batch.iter().map(i64::to_string).collect::<Vec<_>>().join(",");
        let games = client.games(&format!("fields {FACET_FIELDS}; where id = ({list}); limit {BATCH};"))?;
        land(&directory.join(format!("facets-{}-{}.json", batch[0], batch.len())), &games)?;
        let beats = client.ask(TIMES, &format!("fields game_id,hastily,normally,completely; where game_id = ({list}); limit {BATCH};"))?;
        land(&directory.join(format!("times-{}-{}.json", batch[0], batch.len())), &beats)?;
        let by_game = times_in(&beats);
        let mut statements = Vec::new();
        for id in batch {
            let key = id.to_string();
            statements.push(("DELETE FROM game_facet WHERE ext_id = ?".to_string(), vec![json!(key)]));
            for game in games.as_array().into_iter().flatten().filter(|game| game["id"].as_i64() == Some(*id)) {
                for (kind, name) in facets_in(game) {
                    statements.push(("INSERT OR IGNORE INTO game_facet (ext_id, kind, name) VALUES (?, ?, ?)".to_string(), vec![json!(key), json!(kind), json!(name)]));
                    facet_count += 1;
                }
            }
            let (hastily, normally, completely) = by_game.get(id).copied().unwrap_or_default();
            with_times += usize::from(normally.is_some() || hastily.is_some() || completely.is_some());
            statements.push(("INSERT OR REPLACE INTO game_time_to_beat (ext_id, hastily_hours, normally_hours, completely_hours, fetched_at) VALUES (?, ?, ?, ?, ?)".to_string(), vec![json!(key), json!(hastily), json!(normally), json!(completely), json!(now())]));
        }
        session.db.execute_batch(&statements)?;
    }
    println!("facets: {} games asked about, {facet_count} facets, {with_times} with times", ids.len());
    Ok(())
}

pub fn run(session: &Session, everything: bool) -> Result<()> {
    let client = Client::new()?;
    let directory = landing("igdb")?;
    session.shelf.resolve(&session.db, |title, year| {
        let answer = client.games(&format!("search {}; fields name,first_release_date,total_rating_count; limit 10;", quoted(title)))?;
        land(&directory.join(format!("search-{}-{year}.json", slug(title))), &answer)?;
        Ok(hits_in(&answer))
    })?;
    session.shelf.fetch_items(&session.db, everything, |number| {
        let id: i64 = number.parse().with_context(|| format!("«{number}» is not an IGDB number"))?;
        let answer = client.games(&format!("fields {FIELDS}; where id = {id};"))?;
        land(&directory.join(format!("{id}.json")), &answer)?;
        Ok(item_of(&answer[0]))
    })?;
    keep_logos(&client, session, &directory, everything)?;
    keep_facets(&client, session, &directory, everything)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_title_is_quoted_so_it_cannot_end_the_query() {
        assert_eq!(quoted(r#"Say "hi"; fields *"#), r#""Say \"hi\"; fields *""#);
    }

    #[test]
    fn a_search_gives_the_games_with_their_year_and_how_rated_they_are() {
        let hits = hits_in(&json!([{"id": 113_112, "name": "Hades", "first_release_date": 1_600_000_000, "total_rating_count": 800}, {"name": "No number"}]));
        assert_eq!(hits.len(), 1);
        assert_eq!((hits[0].ext_id.as_str(), hits[0].year, hits[0].popularity), ("113112", Some(2020), 800.0));
    }

    #[test]
    fn a_game_has_its_platforms_modes_themes_perspectives_and_series() {
        let game = json!({"id": 1, "platforms": [{"name": "PC (Microsoft Windows)"}, {"name": "Nintendo Switch"}], "game_modes": [{"name": "Single player"}], "themes": [{"name": "Fantasy"}], "collections": [{"name": "Zelda"}]});
        assert_eq!(facets_in(&game), vec![("platform", "PC (Microsoft Windows)".to_string()), ("platform", "Nintendo Switch".to_string()), ("mode", "Single player".to_string()), ("theme", "Fantasy".to_string()), ("series", "Zelda".to_string())]);
        assert!(facets_in(&json!({"id": 2})).is_empty());
    }

    #[test]
    fn the_times_are_hours_to_a_tenth_and_a_missing_time_is_none() {
        let found = times_in(&json!([{"game_id": 7, "hastily": 36000, "normally": 54000, "completely": 0}, {"game_id": 7, "normally": 1}]));
        assert_eq!(found.get(&7), Some(&(Some(10.0), Some(15.0), None)));
        assert_eq!(hours(&json!(null)), None);
    }

    #[test]
    fn a_company_has_a_logo_only_when_the_register_gives_an_image() {
        assert_eq!(logo_of(&json!({"name": "Supergiant", "logo": {"image_id": "cl1"}})).as_deref(), Some("https://images.igdb.com/igdb/image/upload/t_logo_med/cl1.png"));
        assert_eq!(logo_of(&json!({"name": "Tiny Studio"})), None);
    }

    #[test]
    fn a_game_has_its_developer_cover_and_genres() {
        let game = json!({"id": 1, "name": "Hades", "first_release_date": 1_600_000_000, "summary": "Escape.", "url": "https://www.igdb.com/games/hades", "genres": [{"name": "Roguelike"}],
            "cover": {"image_id": "co1abc"}, "involved_companies": [{"developer": false, "company": {"name": "Publisher"}}, {"developer": true, "company": {"name": "Supergiant"}}]});
        let item = item_of(&game).unwrap_or_default();
        assert_eq!((item.creator.as_deref(), item.year, item.genres.clone()), (Some("Supergiant"), Some(2020), vec!["Roguelike".to_string()]));
        assert_eq!(item.cover.as_deref(), Some("https://images.igdb.com/igdb/image/upload/t_cover_big/co1abc.jpg"));
        // A screenshot is the wide picture; artwork stands in for a game with none.
        assert_eq!(item.banner, None);
        let shown = json!({"id": 3, "name": "Y", "screenshots": [{"image_id": "sc1"}], "artworks": [{"image_id": "ar1"}]});
        assert_eq!(item_of(&shown).unwrap_or_default().banner.as_deref(), Some("https://images.igdb.com/igdb/image/upload/t_1080p/sc1.jpg"));
        let artwork_only = json!({"id": 4, "name": "Z", "artworks": [{"image_id": "ar1"}]});
        assert_eq!(item_of(&artwork_only).unwrap_or_default().banner.as_deref(), Some("https://images.igdb.com/igdb/image/upload/t_1080p/ar1.jpg"));
        // With no developer marked, the first company stands in.
        let publisher_only = json!({"id": 2, "name": "X", "involved_companies": [{"company": {"name": "A"}}, {"company": {"name": "B"}}]});
        assert_eq!(item_of(&publisher_only).unwrap_or_default().creator.as_deref(), Some("A"));
        assert_eq!(item_of(&json!(null)), None);
    }
}
