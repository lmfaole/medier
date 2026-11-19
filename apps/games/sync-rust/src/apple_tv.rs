//! The games of the Apple TV: `games-sync apple-tv` reads the apps the account has on it from Apple's data export
//! (landed by hand under `.data/raw/apple/<date>/`, `npm run land -- apple <folder>`): the newest landed zip that holds
//! `Apple Features Using iCloud.zip`, whose `AppleTV/AppleTV.json` lists the apps of both Apple accounts. Every game is
//! `owned` in the collection (format `apple tv`), once, by its bundle id (`appletv:<id>`). The export has no category, no
//! play time and no day, so the streaming and utility apps are named in `NOT_GAMES` and nothing goes to the log.
//! Not kept: the account names and the store front.

use anyhow::{Context, Result};
use serde_json::Value;
use shared_data::shelf::{Entry, Ledger, Session};

const SOURCE: &str = "apple";
const OUTER_PART: &str = "Apple Features Using iCloud.zip";
const LIST: &str = "AppleTV/AppleTV.json";
const FORMAT: &str = "apple tv";
/// The apps of the export that are not games. Apple's own apps have no `ItemName` and are skipped without being listed.
const NOT_GAMES: [&str; 7] = ["no.tv2.sumo", "com.crunchyroll.iphone", "com.spotify.client", "com.apple.TestFlight", "com.tripadvisor.LocalPicks", "com.plexapp.plex", "com.amazon.aiv.AIVApp"];

/// The file is several JSON objects one after the other, not one value.
fn apps_in(text: &str) -> Result<Vec<Entry>> {
    let mut entries = Vec::new();
    for object in serde_json::Deserializer::from_str(text).into_iter::<Value>() {
        let object = object.context("parsing AppleTV.json")?;
        for app in object["Applications"].as_array().into_iter().flatten() {
            let record = &app["recordDictionary"];
            let (Some(title), Some(bundle)) = (record["ItemName"].as_str(), record["BundleID"].as_str()) else { continue };
            if NOT_GAMES.contains(&bundle) {
                continue;
            }
            entries.push(Entry { title: title.trim().to_string(), status: "owned".to_string(), source: Some(format!("appletv:{bundle}")), format: Some(FORMAT.to_string()), ..Entry::default() });
        }
    }
    Ok(entries)
}

fn newest_list() -> Result<String> {
    shared_data::landed::zips(SOURCE)?
        .iter()
        .find_map(|zip| shared_data::landed::text_in(zip, &[OUTER_PART, LIST]))
        .with_context(|| format!("no landed zip under the `{SOURCE}` source holds {OUTER_PART}"))
}

pub fn run(session: &Session) -> Result<()> {
    let games = apps_in(&newest_list()?)?;
    let added = session.shelf.append_new_in(Ledger::Collection, &session.db, &session.collection, &games)?;
    println!("apple-tv: {} games, {added} added to the collection", games.len());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_game_is_owned_by_its_bundle_id_and_a_streaming_app_or_one_of_apples_own_is_left_out() {
        let text = r#"{"Applications": [{"recordDictionary": {"ItemName": " Balatro+ ", "BundleID": "com.playstack.balatroarcade", "AccountName": "a@b.c"}}, {"recordDictionary": {"BundleID": "com.apple.TVMovies"}}]}
            {"Applications": [{"recordDictionary": {"ItemName": "Crunchyroll", "BundleID": "com.crunchyroll.iphone"}}]}"#;
        let games = apps_in(text).expect("apps");
        assert_eq!(games.len(), 1);
        assert_eq!((games[0].title.as_str(), games[0].status.as_str(), games[0].source.as_deref(), games[0].format.as_deref()), ("Balatro+", "owned", Some("appletv:com.playstack.balatroarcade"), Some("apple tv")));
    }
}
