//! The register Open Library: the search that finds a book's work by title, and the work's facts (author, first
//! year, subjects, description, cover). No key is needed, but it asks callers to say who they are (the user agent) and
//! to go gently. A book's number is its work key without the path, such as `OL82563W`.

use std::collections::BTreeMap;
use std::time::Duration;

use anyhow::{Context, Result};
use serde_json::{json, Value};
use shared_data::shelf::{http, landing, now, web_address, Hit, Item, Session};
use shared_data::tmdb::{land, text};

const SITE: &str = "https://openlibrary.org";
const WIKIDATA: &str = "https://www.wikidata.org";
const ALL_ITEMS: &str = "SELECT ext_id FROM book_item ORDER BY ext_id";
const KNOWN_FACTS: &str = "SELECT ext_id FROM book_fact";
const PAUSE: Duration = Duration::from_millis(400);
/// Open Library's subjects run to hundreds of loose phrases; the first few are the ones the pages can use.
const GENRES_KEPT: usize = 6;
const GENRE_LENGTH: usize = 40;

/// The work number in a key such as `/works/OL82563W`.
fn number_of(key: &str) -> Option<String> {
    key.strip_prefix("/works/").filter(|number| !number.is_empty()).map(str::to_string)
}

/// The hits of a title search: each doc's work, with how many ratings it has as its popularity.
fn hits_in(answer: &Value) -> Vec<Hit> {
    answer["docs"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|doc| {
            Some(Hit { ext_id: number_of(doc["key"].as_str()?)?, title: text(&doc["title"])?, year: doc["first_publish_year"].as_i64(), popularity: doc["ratings_count"].as_f64().unwrap_or_default() })
        })
        .collect()
}

/// A description Open Library writes either as text or as `{"type": …, "value": …}`.
fn description_of(work: &Value) -> Option<String> {
    text(&work["description"]).or_else(|| text(&work["description"]["value"]))
}

/// A book from its search doc (title, author, first year, cover, subjects) and its work (the description).
fn item_of(number: &str, doc: &Value, work: &Value) -> Option<Item> {
    Some(Item {
        ext_id: number.to_string(),
        title: text(&doc["title"]).or_else(|| text(&work["title"]))?,
        creator: doc["author_name"].as_array().map(|names| names.iter().filter_map(text).collect::<Vec<_>>().join(", ")).filter(|names| !names.is_empty()),
        year: doc["first_publish_year"].as_i64(),
        summary: description_of(work),
        cover: doc["cover_i"].as_i64().and_then(|cover| web_address(&format!("https://covers.openlibrary.org/b/id/{cover}-L.jpg"))),
        banner: None,
        url: web_address(&format!("{SITE}/works/{number}")),
        genres: doc["subject"].as_array().into_iter().flatten().filter_map(text).filter(|subject| subject.chars().count() <= GENRE_LENGTH).take(GENRES_KEPT).collect(),
    })
}

struct Client {
    http: reqwest::blocking::Client,
    directory: std::path::PathBuf,
}

impl Client {
    fn get(&self, path: &str, query: &[(&str, &str)]) -> Result<Option<Value>> {
        self.get_at(SITE, path, query)
    }

    fn get_at(&self, site: &str, path: &str, query: &[(&str, &str)]) -> Result<Option<Value>> {
        let answer = self.http.get(format!("{site}{path}")).query(query).send().with_context(|| format!("asking Open Library for {path}"))?;
        std::thread::sleep(PAUSE);
        if answer.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        Ok(Some(answer.error_for_status().with_context(|| format!("Open Library answered {path} with an error"))?.json().context("reading Open Library's answer")?))
    }
}

/// What a search doc says of a book: the pages its editions usually have, and its languages (ISO 639-2 codes).
fn facts_in(doc: &Value) -> (Option<i64>, Option<String>) {
    let languages: Vec<&str> = doc["language"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
    (doc["number_of_pages_median"].as_i64().filter(|pages| *pages > 0), (!languages.is_empty()).then(|| languages.join(",")))
}

/// The Wikidata entry Open Library names for an author, from the author's `remote_ids`.
fn wikidata_of(author: &Value) -> Option<String> {
    text(&author["remote_ids"]["wikidata"]).filter(|id| id.starts_with('Q'))
}

/// The country of citizenship (`P27`) a Wikidata entity names first, as the country's entity number.
fn citizenship_of(entity: &Value, id: &str) -> Option<String> {
    entity["entities"][id]["claims"]["P27"].as_array()?.iter().find_map(|claim| text(&claim["mainsnak"]["datavalue"]["value"]["id"]))
}

/// A Wikidata entity's name in Norwegian, else in English.
fn label_of(entities: &Value, id: &str) -> Option<String> {
    text(&entities["entities"][id]["labels"]["nb"]["value"]).or_else(|| text(&entities["entities"][id]["labels"]["en"]["value"]))
}

/// The country an author is a citizen of, through Open Library's author record and Wikidata; none where any hop has nothing.
fn author_country(client: &Client, author_key: &str, countries: &mut BTreeMap<String, Option<String>>) -> Result<Option<String>> {
    let Some(author) = client.get(&format!("/authors/{author_key}.json"), &[])? else { return Ok(None) };
    land(&client.directory.join(format!("author-{author_key}.json")), &author)?;
    let Some(entity) = wikidata_of(&author) else { return Ok(None) };
    let Some(page) = client.get_at(WIKIDATA, &format!("/wiki/Special:EntityData/{entity}.json"), &[])? else { return Ok(None) };
    land(&client.directory.join(format!("wikidata-{entity}.json")), &page)?;
    let Some(country) = citizenship_of(&page, &entity) else { return Ok(None) };
    if let Some(known) = countries.get(&country) {
        return Ok(known.clone());
    }
    let labels = client.get_at(WIKIDATA, "/w/api.php", &[("action", "wbgetentities"), ("ids", country.as_str()), ("props", "labels"), ("languages", "nb|en"), ("format", "json")])?.unwrap_or(Value::Null);
    land(&client.directory.join(format!("wikidata-{country}.json")), &labels)?;
    let name = label_of(&labels, &country);
    countries.insert(country, name.clone());
    Ok(name)
}

/// Asks for the facts of the books that have none yet (every book with `everything`).
fn keep_facts(client: &Client, session: &Session, everything: bool) -> Result<()> {
    let known: std::collections::BTreeSet<String> = if everything { std::collections::BTreeSet::new() } else { session.db.query(KNOWN_FACTS, &[])?.iter().filter_map(|row| row["ext_id"].as_str().map(str::to_string)).collect() };
    let numbers: Vec<String> = session.db.query(ALL_ITEMS, &[])?.iter().filter_map(|row| row["ext_id"].as_str().map(str::to_string)).filter(|number| !known.contains(number)).collect();
    let mut countries = BTreeMap::new();
    let mut found = 0;
    for number in &numbers {
        let key = format!("key:/works/{number}");
        let answer = client.get("/search.json", &[("q", key.as_str()), ("limit", "1"), ("fields", "key,number_of_pages_median,language,author_key")])?.unwrap_or(Value::Null);
        land(&client.directory.join(format!("facts-{number}.json")), &answer)?;
        let doc = &answer["docs"][0];
        let (pages, languages) = facts_in(doc);
        let country = match doc["author_key"][0].as_str() {
            Some(author) => author_country(client, author, &mut countries)?,
            None => None,
        };
        found += usize::from(pages.is_some() || languages.is_some() || country.is_some());
        session.db.execute("INSERT OR REPLACE INTO book_fact (ext_id, pages, languages, author_country, fetched_at) VALUES (?, ?, ?, ?, ?)", &[json!(number), json!(pages), json!(languages), json!(country), json!(now())])?;
    }
    println!("facts: {} books asked about, {found} with something", numbers.len());
    Ok(())
}

pub fn run(session: &Session, everything: bool) -> Result<()> {
    let client = Client { http: http("books-sync (lmfaole.party; hei@lmfaole.party)")?, directory: landing("openlibrary")? };
    session.shelf.resolve(&session.db, |title, year| {
        let answer = client.get("/search.json", &[("title", title), ("limit", "10"), ("fields", "key,title,first_publish_year,ratings_count")])?.unwrap_or(Value::Null);
        land(&client.directory.join(format!("search-{}-{year}.json", shared_data::text::slug(title))), &answer)?;
        Ok(hits_in(&answer))
    })?;
    session.shelf.fetch_items(&session.db, everything, |number| {
        let key = format!("key:/works/{number}");
        let found = client.get("/search.json", &[("q", key.as_str()), ("limit", "1"), ("fields", "key,title,first_publish_year,author_name,cover_i,subject")])?.unwrap_or(Value::Null);
        let Some(work) = client.get(&format!("/works/{number}.json"), &[])? else { return Ok(None) };
        land(&client.directory.join(format!("{number}.json")), &serde_json::json!({ "search": found, "work": work }))?;
        Ok(item_of(number, &found["docs"][0], &work))
    })?;
    keep_facts(&client, session, everything)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_search_doc_gives_its_pages_and_languages_and_an_author_a_wikidata_country() {
        assert_eq!(facts_in(&json!({"number_of_pages_median": 320, "language": ["eng", "fre"]})), (Some(320), Some("eng,fre".to_string())));
        assert_eq!(facts_in(&json!({"number_of_pages_median": 0})), (None, None));
        assert_eq!(wikidata_of(&json!({"remote_ids": {"wikidata": "Q42"}})).as_deref(), Some("Q42"));
        assert_eq!(wikidata_of(&json!({"remote_ids": {}})), None);
        let entity = json!({"entities": {"Q42": {"claims": {"P27": [{"mainsnak": {"datavalue": {"value": {"id": "Q145"}}}}]}}}});
        assert_eq!(citizenship_of(&entity, "Q42").as_deref(), Some("Q145"));
        let labels = json!({"entities": {"Q145": {"labels": {"en": {"value": "United Kingdom"}}}}});
        assert_eq!(label_of(&labels, "Q145").as_deref(), Some("United Kingdom"));
    }

    #[test]
    fn a_search_gives_works_with_their_numbers_and_skips_what_has_none() {
        let hits = hits_in(&json!({"docs": [
            {"key": "/works/OL1W", "title": "Dune", "first_publish_year": 1965, "ratings_count": 900},
            {"key": "/books/OL2M", "title": "Not a work"},
            {"key": "/works/OL3W", "title": "Dune Messiah"}
        ]}));
        assert_eq!(hits.len(), 2);
        assert_eq!((hits[0].ext_id.as_str(), hits[0].year, hits[0].popularity), ("OL1W", Some(1965), 900.0));
    }

    #[test]
    fn a_book_has_its_author_cover_and_a_description_written_either_way() {
        let doc = json!({"title": "Dune", "author_name": ["Frank Herbert"], "first_publish_year": 1965, "cover_i": 42, "subject": ["Science fiction", &"x".repeat(60)]});
        let item = item_of("OL1W", &doc, &json!({"description": {"type": "/type/text", "value": "A desert planet."}})).unwrap_or_default();
        assert_eq!((item.creator.as_deref(), item.summary.as_deref(), item.genres.clone()), (Some("Frank Herbert"), Some("A desert planet."), vec!["Science fiction".to_string()]));
        assert_eq!(item.cover.as_deref(), Some("https://covers.openlibrary.org/b/id/42-L.jpg"));
        assert_eq!(item_of("OL1W", &doc, &json!({"description": "Plain."})).unwrap_or_default().summary.as_deref(), Some("Plain."));
        assert_eq!(item_of("OL1W", &json!({}), &json!({})), None);
    }
}
