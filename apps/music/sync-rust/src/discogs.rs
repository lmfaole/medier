//! Discogs, where the owner keeps the records. `music-sync discogs` lands the collection and the wantlist under
//! `.data/raw/discogs/<date>/`, makes `discogs_item` exactly what they say and lays them over `music_collection`
//! (`overlay`): a line of `music-collection.csv` for the same album wins, the rest are added as owned or wanted.
//! Reading a collection needs it to be public in Discogs' privacy settings, or a token; `DISCOGS_USER`, `DISCOGS_KEY`
//! and `DISCOGS_SECRET` name the account and the application's key.

use std::collections::HashMap;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use shared_data::batch::insert_statements;
use shared_data::shelf::{http, landing, now};
use shared_data::sqlite_client::SqliteClient;
use shared_data::text::normalize;
use shared_data::tmdb::land;

const API: &str = "https://api.discogs.com";
const PAGE: usize = 100;
/// Discogs allows sixty calls a minute with a key.
const PAUSE: Duration = Duration::from_millis(1100);
/// The marker `overlay` puts in `note`, so a rerun removes exactly the lines it added.
const MARKER: &str = "discogs:";

const DETAIL_COLUMNS: [&str; 6] = ["release_id", "genres", "styles", "master_id", "master_year", "fetched_at"];
const KNOWN_MASTERS_SQL: &str = "SELECT master_id, master_year FROM discogs_detail WHERE master_id IS NOT NULL AND master_year IS NOT NULL";
const MUSICBRAINZ: &str = "https://musicbrainz.org/ws/2/url";
const ARCHIVE: &str = "https://coverartarchive.org/release";
const GROUPS: &str = "https://musicbrainz.org/ws/2/release-group";
const GROUP_ARCHIVE: &str = "https://coverartarchive.org/release-group";
/// MusicBrainz allows one call a second.
const MB_PAUSE: Duration = Duration::from_millis(1100);
const NEEDING_COVERS_SQL: &str = "SELECT release_id, artist, title FROM discogs_item WHERE release_id NOT IN (SELECT release_id FROM discogs_cover) ORDER BY release_id";
const ITEM_COLUMNS: [&str; 12] = ["instance_id", "release_id", "status", "artist", "title", "year", "format", "label", "catalogue_number", "rating", "added_on", "fetched_at"];
const ITEMS_SQL: &str = "SELECT instance_id, status, artist, title, year, format, rating, added_on FROM discogs_item ORDER BY instance_id";
const COLLECTION_SQL: &str = "SELECT artist, title FROM music_collection WHERE kind = 'album' AND (note IS NULL OR note NOT LIKE 'discogs:%')";
const CLEAR_SQL: &str = "DELETE FROM music_collection WHERE note LIKE 'discogs:%'";

/// Discogs tells artists of one name apart with a number: «Prince (2)» is «Prince».
fn clean_name(name: &str) -> String {
    let name = name.trim();
    match name.rsplit_once(" (") {
        Some((head, tail)) if tail.strip_suffix(')').is_some_and(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit())) => head.trim().to_string(),
        _ => name.to_string(),
    }
}

/// The artists of a release as the sleeve reads: «A & B» from each name and its joiner.
fn artists_of(info: &Value) -> String {
    let mut text = String::new();
    for artist in info["artists"].as_array().into_iter().flatten() {
        text.push_str(&clean_name(artist["name"].as_str().unwrap_or_default()));
        let join = artist["join"].as_str().unwrap_or_default().trim();
        match join {
            "" => {}
            "," => text.push_str(", "),
            other => {
                text.push(' ');
                text.push_str(other);
                text.push(' ');
            }
        }
    }
    text.trim().trim_end_matches(',').trim().to_string()
}

fn format_of(info: &Value) -> Option<String> {
    let mut names: Vec<String> = Vec::new();
    for format in info["formats"].as_array().into_iter().flatten() {
        let name = match format["name"].as_str().unwrap_or_default() {
            "Cassette" => "kassett".to_string(),
            "File" => "digital".to_string(),
            other => other.to_lowercase(),
        };
        if !name.is_empty() && !names.contains(&name) {
            names.push(name);
        }
    }
    (!names.is_empty()).then(|| names.join(","))
}

/// Discogs rates in whole stars, 0 for none; the collection has half steps from 0.5.
fn rating_of(value: &Value) -> Option<f64> {
    value.as_f64().filter(|stars| *stars >= 1.0).map(|stars| stars.min(5.0))
}

/// The row of `discogs_item` for one item of either list, or none when it names no release or artist.
fn row_of(item: &Value, status: &str, fetched_at: i64, master_years: &HashMap<i64, i64>) -> Option<Vec<Value>> {
    let info = &item["basic_information"];
    let release = info["id"].as_i64()?;
    let (artist, title) = (artists_of(info), info["title"].as_str()?.trim().to_string());
    if artist.is_empty() || title.is_empty() {
        return None;
    }
    let label = info["labels"][0]["name"].as_str().map(str::to_string);
    let catalogue = info["labels"][0]["catno"].as_str().filter(|n| !n.is_empty() && *n != "none").map(str::to_string);
    let added = item["date_added"].as_str().and_then(|day| day.get(..10)).map(str::to_string);
    let instance = item["instance_id"].as_i64().unwrap_or(release);
    Some(vec![json!(instance), json!(release), json!(status), json!(artist), json!(title), json!(year_of(info, master_years)), json!(format_of(info)), json!(label), json!(catalogue), json!(rating_of(&item["rating"])), json!(added), json!(fetched_at)])
}

/// The year the work came out: its master's where Discogs has one (a reissue's own year is the pressing's, or none), else the release's.
fn year_of(info: &Value, master_years: &HashMap<i64, i64>) -> Option<i64> {
    info["master_id"].as_i64().and_then(|master| master_years.get(&master).copied()).or_else(|| info["year"].as_i64()).filter(|year| *year > 0)
}

/// A list of names joined with bars (a genre has commas in it), or none when it is empty.
fn names_of(list: &Value) -> Option<String> {
    let names: Vec<&str> = list.as_array().into_iter().flatten().filter_map(Value::as_str).collect();
    (!names.is_empty()).then(|| names.join("|"))
}

/// The row of `discogs_detail` for one item: its genres and styles and its master.
fn detail_of(item: &Value, master_years: &HashMap<i64, i64>, fetched_at: i64) -> Option<Vec<Value>> {
    let info = &item["basic_information"];
    let master = info["master_id"].as_i64().filter(|id| *id > 0);
    Some(vec![json!(info["id"].as_i64()?), json!(names_of(&info["genres"])), json!(names_of(&info["styles"])), json!(master), json!(master.and_then(|id| master_years.get(&id).copied())), json!(fetched_at)])
}

fn store(db: &SqliteClient, collection: &[Value], wants: &[Value], master_years: &HashMap<i64, i64>) -> Result<usize> {
    let at = now();
    let mut rows: Vec<Vec<Value>> = collection.iter().filter_map(|item| row_of(item, "owned", at, master_years)).collect();
    rows.extend(wants.iter().filter_map(|item| row_of(item, "want", at, master_years)));
    let details: Vec<Vec<Value>> = collection.iter().chain(wants).filter_map(|item| detail_of(item, master_years, at)).collect();
    let count = rows.len();
    let mut batch = vec![("DELETE FROM discogs_item".to_string(), Vec::new()), ("DELETE FROM discogs_detail".to_string(), Vec::new())];
    batch.extend(insert_statements("INSERT OR REPLACE INTO", "discogs_item", &ITEM_COLUMNS, rows));
    batch.extend(insert_statements("INSERT OR REPLACE INTO", "discogs_detail", &DETAIL_COLUMNS, details));
    db.execute_batch(&batch).context("storing what Discogs returned")?;
    Ok(count)
}

/// Lays `discogs_item` over `music_collection`: the lines of an earlier run go, and every item the hand-written lines do
/// not already name is added, with the day it was added, its format and its rating. Called after `import-collection` too.
pub fn overlay(db: &SqliteClient) -> Result<usize> {
    let known: Vec<(String, String)> = db.query(COLLECTION_SQL, &[])?.iter().map(|row| (normalize(row["artist"].as_str().unwrap_or_default()), normalize(row["title"].as_str().unwrap_or_default()))).collect();
    let mut added = Vec::new();
    for item in db.query(ITEMS_SQL, &[])? {
        let key = (normalize(item["artist"].as_str().unwrap_or_default()), normalize(item["title"].as_str().unwrap_or_default()));
        if known.contains(&key) {
            continue;
        }
        let note = format!("{MARKER}{}", item["instance_id"]);
        added.push(vec![item["added_on"].clone(), json!("album"), item["artist"].clone(), item["title"].clone(), item["year"].clone(), item["status"].clone(), item["rating"].clone(), json!(note), Value::Null, item["format"].clone()]);
    }
    let count = added.len();
    let mut batch = vec![(CLEAR_SQL.to_string(), Vec::new())];
    batch.extend(insert_statements("INSERT INTO", "music_collection", &["added_on", "kind", "artist", "title", "year", "status", "rating", "note", "mbid", "format"], added));
    db.execute_batch(&batch).context("laying Discogs over the collection")?;
    Ok(count)
}

/// Every page of a list, landed once each as `<name>-<page>.json`.
fn fetch_list(client: &reqwest::blocking::Client, auth: &str, url: &str, key: &str, directory: &std::path::Path, name: &str) -> Result<Vec<Value>> {
    let mut all = Vec::new();
    for page in 1.. {
        let answer = client.get(url).query(&[("per_page", PAGE), ("page", page)]).header("Authorization", auth).send().with_context(|| format!("asking Discogs for {name}"))?;
        std::thread::sleep(PAUSE);
        if answer.status() == reqwest::StatusCode::UNAUTHORIZED || answer.status() == reqwest::StatusCode::FORBIDDEN {
            bail!("Discogs will not show {name}: make it public in the privacy settings, or use a token");
        }
        let body: Value = answer.error_for_status().with_context(|| format!("Discogs answered {name} with an error"))?.json().context("reading Discogs' answer")?;
        land(&directory.join(format!("{name}-{page}.json")), &body)?;
        all.extend(body[key].as_array().cloned().unwrap_or_default());
        if page >= body["pagination"]["pages"].as_u64().map_or(1, |pages| usize::try_from(pages).unwrap_or(usize::MAX)) {
            return Ok(all);
        }
    }
    unreachable!("the loop returns on the last page")
}

/// The year of each master the items belong to: the ones kept before, and the new ones asked for (one call each, landed).
fn fetch_masters<'a>(db: &SqliteClient, client: &reqwest::blocking::Client, auth: &str, directory: &std::path::Path, items: impl Iterator<Item = &'a Value>) -> Result<HashMap<i64, i64>> {
    let mut years: HashMap<i64, i64> = db.query(KNOWN_MASTERS_SQL, &[])?.iter().filter_map(|row| Some((row["master_id"].as_i64()?, row["master_year"].as_i64()?))).collect();
    for master in items.filter_map(|item| item["basic_information"]["master_id"].as_i64()).filter(|id| *id > 0) {
        if years.contains_key(&master) {
            continue;
        }
        let answer = client.get(format!("{API}/masters/{master}")).header("Authorization", auth).send().with_context(|| format!("asking Discogs for master {master}"))?;
        std::thread::sleep(PAUSE);
        if !answer.status().is_success() {
            continue;
        }
        let body: Value = answer.json().context("reading Discogs' answer")?;
        land(&directory.join(format!("master-{master}.json")), &body)?;
        if let Some(year) = body["year"].as_i64().filter(|year| *year > 0) {
            years.insert(master, year);
        }
    }
    Ok(years)
}

/// The MusicBrainz release a Discogs release's URL names, from the `url` lookup with `inc=release-rels`.
fn release_in(answer: &Value) -> Option<String> {
    answer["relations"].as_array()?.iter().find_map(|relation| relation["release"]["id"].as_str().map(str::to_string))
}

/// The front image of a release, from the Cover Art Archive's list of its images.
fn front_in(answer: &Value) -> Option<String> {
    let images = answer["images"].as_array()?;
    let front = images.iter().find(|image| image["front"] == true).or_else(|| images.first())?;
    front["id"].as_i64().map(|id| id.to_string()).or_else(|| front["id"].as_str().map(str::to_string))
}

/// The release and the image an archive image address names: `…/release/<release mbid>/<image id>.jpg`.
fn release_and_image_of(address: &str) -> Option<(String, String)> {
    let rest = address.split("/release/").nth(1)?;
    let (release, file) = rest.split_once('/')?;
    let image = file.split('.').next()?;
    (release.len() == 36 && !image.is_empty() && image.chars().all(|c| c.is_ascii_digit())).then(|| (release.to_string(), image.to_string()))
}

/// Where a release has no address of its own in MusicBrainz, the album by its name: the best release group of that artist and title, and the front image of any release of it.
fn group_cover(client: &reqwest::blocking::Client, directory: &std::path::Path, release: i64, artist: &str, title: &str) -> Result<Option<(String, String)>> {
    let clean = |text: &str| text.replace('"', " ");
    let query = format!("artist:\"{}\" AND releasegroup:\"{}\"", clean(artist), clean(title));
    let answer = client.get(GROUPS).query(&[("query", query.as_str()), ("limit", "5"), ("fmt", "json")]).send().with_context(|| format!("searching MusicBrainz for {title}"))?;
    std::thread::sleep(MB_PAUSE);
    if !answer.status().is_success() {
        return Ok(None);
    }
    let body: Value = answer.json().context("reading MusicBrainz' answer")?;
    land(&directory.join(format!("musicbrainz-search-{release}.json")), &body)?;
    let wanted = normalize(title);
    let Some(group) = body["release-groups"].as_array().into_iter().flatten().find(|group| group["score"].as_i64().unwrap_or(0) >= 90 && group["title"].as_str().is_some_and(|name| normalize(name) == wanted)) else { return Ok(None) };
    let Some(id) = group["id"].as_str() else { return Ok(None) };
    let images = client.get(format!("{GROUP_ARCHIVE}/{id}")).send().with_context(|| format!("asking the Cover Art Archive about {id}"))?;
    std::thread::sleep(MB_PAUSE);
    if !images.status().is_success() {
        return Ok(None);
    }
    let body: Value = images.json().context("reading the Cover Art Archive's answer")?;
    land(&directory.join(format!("archive-group-{id}.json")), &body)?;
    let all = body["images"].as_array().cloned().unwrap_or_default();
    Ok(all.iter().find(|image| image["front"] == true).or_else(|| all.first()).and_then(|image| image["image"].as_str()).and_then(release_and_image_of))
}

/// Finds a cover for each release not asked about yet: MusicBrainz names the release by Discogs' address, the archive has its image.
fn find_covers(db: &SqliteClient, client: &reqwest::blocking::Client, directory: &std::path::Path) -> Result<usize> {
    let mut found = 0;
    for row in db.query(NEEDING_COVERS_SQL, &[])? {
        let Some(release) = row["release_id"].as_i64() else { continue };
        let lookup = client.get(MUSICBRAINZ).query(&[("resource", format!("https://www.discogs.com/release/{release}").as_str()), ("inc", "release-rels"), ("fmt", "json")]).send().with_context(|| format!("asking MusicBrainz about release {release}"))?;
        std::thread::sleep(MB_PAUSE);
        let mbid = if lookup.status().is_success() {
            let body: Value = lookup.json().context("reading MusicBrainz' answer")?;
            land(&directory.join(format!("musicbrainz-{release}.json")), &body)?;
            release_in(&body)
        } else {
            None
        };
        let image = match &mbid {
            Some(mbid) => {
                let answer = client.get(format!("{ARCHIVE}/{mbid}")).send().with_context(|| format!("asking the Cover Art Archive about {mbid}"))?;
                std::thread::sleep(MB_PAUSE);
                if answer.status().is_success() {
                    let body: Value = answer.json().context("reading the Cover Art Archive's answer")?;
                    land(&directory.join(format!("archive-{mbid}.json")), &body)?;
                    front_in(&body)
                } else {
                    None
                }
            }
            None => None,
        };
        let (mbid, image) = match (mbid, image) {
            (mbid, Some(image)) => (mbid, Some(image)),
            (_, None) => match group_cover(client, directory, release, row["artist"].as_str().unwrap_or_default(), row["title"].as_str().unwrap_or_default())? {
                Some((mbid, image)) => (Some(mbid), Some(image)),
                None => (None, None),
            },
        };
        found += usize::from(image.is_some());
        db.execute("INSERT OR REPLACE INTO discogs_cover (release_id, release_mbid, image_id, tried_at) VALUES (?, ?, ?, ?)", &[json!(release), json!(mbid), json!(image), json!(now())])?;
    }
    Ok(found)
}

/// Pulls the collection and the wantlist, makes `discogs_item` exactly that and lays it over the collection.
pub fn pull(db: &SqliteClient) -> Result<()> {
    let (user, key, secret) = (env("DISCOGS_USER")?, env("DISCOGS_KEY")?, env("DISCOGS_SECRET")?);
    let client = http("music-sync (lmfaole.party; hei@lmfaole.party)")?;
    let auth = format!("Discogs key={key}, secret={secret}");
    let directory = landing("discogs")?;
    let collection = fetch_list(&client, &auth, &format!("{API}/users/{user}/collection/folders/0/releases"), "releases", &directory, "collection")?;
    let wants = fetch_list(&client, &auth, &format!("{API}/users/{user}/wants"), "wants", &directory, "wants")?;
    let master_years = fetch_masters(db, &client, &auth, &directory, collection.iter().chain(&wants))?;
    let stored = store(db, &collection, &wants, &master_years)?;
    let covers = find_covers(db, &client, &directory)?;
    println!("discogs: {covers} new covers; {stored} items ({} owned, {} wanted), {} laid over the collection", collection.len(), wants.len(), overlay(db)?);
    Ok(())
}

fn env(name: &str) -> Result<String> {
    std::env::var(name).with_context(|| format!("{name} is not set: it is in music-sync.env"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_lose_discogs_numbers_but_not_years() {
        assert_eq!(clean_name("Prince (2)"), "Prince");
        assert_eq!(clean_name("Sigur Rós"), "Sigur Rós");
        assert_eq!(clean_name("Blur (live)"), "Blur (live)");
    }

    #[test]
    fn a_release_becomes_a_row() {
        let item = json!({"instance_id": 7, "date_added": "2025-12-06T07:08:51-08:00", "rating": 4, "basic_information": {"id": 1, "title": "Dangerously In Love", "year": 2003,
            "formats": [{"name": "CD"}, {"name": "Cassette"}, {"name": "CD"}], "labels": [{"name": "Columbia", "catno": "2 509395"}],
            "artists": [{"name": "Beyoncé", "join": ""}]}});
        let row = row_of(&item, "owned", 5, &HashMap::new()).unwrap();
        assert_eq!(row, vec![json!(7), json!(1), json!("owned"), json!("Beyoncé"), json!("Dangerously In Love"), json!(2003), json!("cd,kassett"), json!("Columbia"), json!("2 509395"), json!(4.0), json!("2025-12-06"), json!(5)]);
    }

    #[test]
    fn a_release_and_its_front_image_are_found_in_the_answers() {
        assert_eq!(release_in(&json!({"relations": [{"release": {"id": "abc"}}]})).as_deref(), Some("abc"));
        assert_eq!(release_in(&json!({"relations": []})), None);
        assert_eq!(front_in(&json!({"images": [{"id": 1, "front": false}, {"id": 22, "front": true}]})).as_deref(), Some("22"));
        assert_eq!(front_in(&json!({"images": [{"id": 5, "front": false}]})).as_deref(), Some("5"));
        assert_eq!(front_in(&json!({"images": []})), None);
    }

    #[test]
    fn an_archive_image_address_names_its_release_and_image() {
        let release = "0e3f5a57-90a1-4a5c-a1c9-2b9a5c1c0a11";
        assert_eq!(release_and_image_of(&format!("http://coverartarchive.org/release/{release}/123456.jpg")), Some((release.to_string(), "123456".to_string())));
        assert_eq!(release_and_image_of("http://example.test/a.jpg"), None);
    }

    #[test]
    fn a_reissue_has_its_masters_year() {
        let info = json!({"year": 2016, "master_id": 9});
        assert_eq!(year_of(&info, &HashMap::from([(9, 2010)])), Some(2010));
        assert_eq!(year_of(&info, &HashMap::new()), Some(2016));
        assert_eq!(year_of(&json!({"year": 0}), &HashMap::new()), None);
        assert_eq!(names_of(&json!(["Pop", "Rock"])).as_deref(), Some("Pop|Rock"));
        assert_eq!(names_of(&json!([])), None);
    }

    #[test]
    fn artists_are_joined_as_the_sleeve_reads() {
        let info = json!({"artists": [{"name": "Marina (3)", "join": "&"}, {"name": "The Diamonds", "join": ""}]});
        assert_eq!(artists_of(&info), "Marina & The Diamonds");
    }
}
