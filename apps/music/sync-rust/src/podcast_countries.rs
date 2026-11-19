//! Where the shows are made, from Wikidata (`country of origin`, P495). For each show with a few plays and no row in
//! `podcast_show_country` yet, this looks for a Wikidata item whose label is the show's name and whose description
//! calls it a podcast, lands the answers unchanged under `.data/raw/wikidata/<date>/`, and writes the country (in
//! Norwegian) with the item's number as the note. A show Wikidata does not know, or has no country for, is left
//! alone: a row written by hand is never replaced.

use std::collections::BTreeSet;
use std::path::Path;
use std::time::Duration;

use anyhow::{Context, Result};
use serde_json::{json, Value};
use shared_data::sqlite_client::SqliteClient;
use shared_data::text::normalize;

use crate::slug::slug;

const API: &str = "https://www.wikidata.org/w/api.php";
const MIN_PLAYS: i64 = 3;
const PAUSE: Duration = Duration::from_millis(1200);

const SQL_SHOWS: &str = "SELECT show_name FROM podcast_show_info WHERE show_name NOT IN (SELECT show_name FROM podcast_show_country) \
    AND show_name IN (SELECT show_name FROM podcast_plays WHERE ms_played >= 60000 GROUP BY show_name HAVING COUNT(*) >= ?)";

/// The item among a search's results that is the show: its label is the show's name and its description says podcast.
#[must_use]
pub fn pick(search: &Value, show: &str) -> Option<String> {
    let wanted = normalize(show);
    search["search"].as_array()?.iter().find_map(|item| {
        let label = item["label"].as_str()?;
        let description = item["description"].as_str().unwrap_or_default().to_lowercase();
        (normalize(label) == wanted && description.contains("podcast")).then(|| item["id"].as_str().map(str::to_string))?
    })
}

/// The first country of origin (P495) an item names, as an item number.
#[must_use]
pub fn country_id(entities: &Value, item: &str) -> Option<String> {
    entities["entities"][item]["claims"]["P495"].as_array()?.iter().find_map(|claim| claim["mainsnak"]["datavalue"]["value"]["id"].as_str().map(str::to_string))
}

/// An item's label, Norwegian first, then English.
#[must_use]
pub fn label(entities: &Value, item: &str) -> Option<String> {
    let labels = &entities["entities"][item]["labels"];
    ["nb", "no", "en"].iter().find_map(|language| labels[language]["value"].as_str().map(str::to_string))
}

fn get(client: &reqwest::blocking::Client, query: &[(&str, &str)]) -> Result<Value> {
    let answer = client
        .get(API)
        .query(&[("format", "json")])
        .query(query)
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .context("asking Wikidata")?
        .json()
        .context("reading Wikidata's answer")?;
    std::thread::sleep(PAUSE);
    Ok(answer)
}

fn land(directory: &Path, name: &str, answer: &Value) -> Result<()> {
    let path = directory.join(name);
    if !path.exists() {
        std::fs::write(&path, serde_json::to_string_pretty(answer)?).with_context(|| format!("landing {}", path.display()))?;
    }
    Ok(())
}

/// The country of one show, or `None` where Wikidata has no podcast of that name with a country.
fn country_of(client: &reqwest::blocking::Client, show: &str, directory: &Path) -> Result<Option<(String, String)>> {
    let search = get(client, &[("action", "wbsearchentities"), ("search", show), ("language", "en"), ("type", "item"), ("limit", "8")])?;
    land(directory, &format!("{}.search.json", slug(show)), &search)?;
    let Some(item) = pick(&search, show) else { return Ok(None) };
    let entity = get(client, &[("action", "wbgetentities"), ("ids", &item), ("props", "claims")])?;
    land(directory, &format!("{}.entity.json", slug(show)), &entity)?;
    let Some(country) = country_id(&entity, &item) else { return Ok(None) };
    let labels = get(client, &[("action", "wbgetentities"), ("ids", &country), ("props", "labels"), ("languages", "nb|no|en")])?;
    land(directory, &format!("{}.country.json", slug(show)), &labels)?;
    Ok(label(&labels, &country).map(|name| (name, item)))
}

/// The `podcast-countries` job.
pub fn run(db: &SqliteClient) -> Result<()> {
    let shows: BTreeSet<String> = db.query(SQL_SHOWS, &[json!(MIN_PLAYS)])?.iter().filter_map(|row| row["show_name"].as_str().map(str::to_string)).collect();
    let directory = shared_data::raw::landing_path("wikidata", chrono::Utc::now().date_naive())?;
    std::fs::create_dir_all(&directory).with_context(|| format!("creating {}", directory.display()))?;
    let client = crate::listenbrainz::http_client()?;
    let (mut found, mut unknown, mut failed) = (0, 0, 0);
    for show in &shows {
        match country_of(&client, show, &directory) {
            Ok(Some((country, item))) => {
                db.execute(
                    "INSERT OR IGNORE INTO podcast_show_country (show_name, country, note) VALUES (?, ?, ?)",
                    &[json!(show), json!(country), json!(format!("Wikidata {item}"))],
                )?;
                found += 1;
            }
            Ok(None) => unknown += 1,
            Err(error) => {
                failed += 1;
                eprintln!("{show}: {error:#}");
            }
        }
    }
    println!("podcast-countries: {found} countries found, {unknown} shows Wikidata has no country for, {failed} failed, of {} looked for", shows.len());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn search() -> Value {
        json!({"search": [
            {"id": "Q1", "label": "Debatten", "description": "Norwegian TV programme"},
            {"id": "Q2", "label": "Debatten!", "description": "Norwegian radio podcast"},
            {"id": "Q3", "label": "Debatten Extra", "description": "podcast"}
        ]})
    }

    #[test]
    fn the_show_is_the_item_with_its_name_that_is_called_a_podcast() {
        assert_eq!(pick(&search(), "debatten"), Some("Q2".to_string()));
        assert_eq!(pick(&search(), "Nope"), None);
        assert_eq!(pick(&json!({}), "Debatten"), None);
    }

    #[test]
    fn the_country_is_the_first_of_origin_and_the_label_is_norwegian_before_english() {
        let entities = json!({"entities": {"Q2": {"claims": {"P495": [
            {"mainsnak": {"datavalue": {"value": {"id": "Q20"}}}},
            {"mainsnak": {"datavalue": {"value": {"id": "Q30"}}}}
        ]}}}});
        assert_eq!(country_id(&entities, "Q2"), Some("Q20".to_string()));
        assert_eq!(country_id(&entities, "Q9"), None);
        let labels = json!({"entities": {"Q20": {"labels": {"en": {"value": "Norway"}, "nb": {"value": "Norge"}}}, "Q30": {"labels": {"en": {"value": "United States"}}}}});
        assert_eq!((label(&labels, "Q20"), label(&labels, "Q30"), label(&labels, "Q1")), (Some("Norge".to_string()), Some("United States".to_string()), None));
    }

    #[test]
    fn a_show_with_a_country_already_is_not_looked_for() {
        let db = SqliteClient::open(Path::new(":memory:")).unwrap_or_else(|error| panic!("{error}"));
        shared_data::app_db::apply_schema(&db, crate::podcasts::SCHEMA).unwrap_or_else(|error| panic!("{error}"));
        for show in ["Has country", "Needs one", "Too few plays"] {
            db.execute("INSERT INTO podcast_show_info (show_name, title, fetched_at) VALUES (?, ?, 0)", &[json!(show), json!(show)]).unwrap_or_else(|error| panic!("{error}"));
        }
        for (show, plays) in [("Has country", 5), ("Needs one", 5), ("Too few plays", 1)] {
            for at in 0..plays {
                db.execute(
                    "INSERT INTO podcast_plays (started_at, show_name, episode_name, episode_uri, ms_played) VALUES (?, ?, 'e', ?, 600000)",
                    &[json!(at), json!(show), json!(format!("{show}{at}"))],
                )
                .unwrap_or_else(|error| panic!("{error}"));
            }
        }
        db.execute("INSERT INTO podcast_show_country (show_name, country) VALUES ('Has country', 'Norge')", &[]).unwrap_or_else(|error| panic!("{error}"));
        let rows = db.query(SQL_SHOWS, &[json!(MIN_PLAYS)]).unwrap_or_default();
        assert_eq!(rows.iter().filter_map(|row| row["show_name"].as_str()).collect::<Vec<_>>(), vec!["Needs one"]);
    }
}
