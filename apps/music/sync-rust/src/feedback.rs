//! The tracks the owner has loved on Last.fm, kept beside the listens. The loves live at Last.fm and can
//! be taken back there, so each run replaces the whole table with what Last.fm says now; an answer that
//! does not add up to the total it announced is refused and changes nothing. Last.fm has no "hate", so
//! every row scores 1. The pages are landed unchanged under `.data/raw/lastfm-loved/<date>/`. Every page is
//! fetched once a day; a later run that day asks for one page and stops there when it shows nothing new (`first_page.rs`).

use std::path::Path;

use anyhow::{bail, Context, Result};
use serde::Deserialize;
use serde_json::json;
use shared_data::batch::insert_statements;
use shared_data::sqlite_client::SqliteClient;

const PAGE_SIZE: &str = "200";
const SQL_CLEAR: &str = "DELETE FROM recording_feedback";
const SQL_LOVED_COUNT: &str = "SELECT COUNT(*) AS count FROM lastfm_loved";
const SQL_LOVED_SINCE: &str = "SELECT artist_name, track_name, loved_at FROM lastfm_loved WHERE loved_at >= ?";
const COLUMNS: &[&str] = &["recording_mbid", "score", "created_at", "track_name", "artist_name", "release_name"];
/// Every recording id the listens carry with its album, most heard first per artist and track: Last.fm's own id for a loved track is often empty.
const SQL_KNOWN_RECORDINGS: &str = "SELECT lower(artist_name) AS artist, lower(track_name) AS track, recording_mbid, MAX(release_name) AS release_name
  FROM listens WHERE recording_mbid IS NOT NULL GROUP BY artist, track, recording_mbid ORDER BY COUNT(*) ASC";

/// (artist, track), lower-cased, to the recording and album heard most; later rows (more heard) overwrite earlier ones.
pub type Known = std::collections::HashMap<(String, String), (String, Option<String>)>;

pub fn load_known(db: &SqliteClient) -> Result<Known> {
    let mut known = Known::new();
    for row in db.query(SQL_KNOWN_RECORDINGS, &[])? {
        if let (Some(artist), Some(track), Some(mbid)) = (row["artist"].as_str(), row["track"].as_str(), row["recording_mbid"].as_str()) {
            known.insert((artist.to_string(), track.to_string()), (mbid.to_string(), row["release_name"].as_str().map(str::to_string)));
        }
    }
    Ok(known)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Feedback {
    pub recording_mbid: String,
    /// 1 loved, -1 hated.
    pub score: i64,
    pub created_at: i64,
    pub track_name: Option<String>,
    pub artist_name: Option<String>,
    pub release_name: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Loved {
    pub track: String,
    pub artist: String,
    pub recording_mbid: Option<String>,
    pub at: i64,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Page {
    pub items: Vec<Loved>,
    pub total_pages: u32,
    pub total: usize,
}

#[derive(Deserialize)]
struct Envelope {
    lovedtracks: Tracks,
}

#[derive(Deserialize)]
struct Tracks {
    #[serde(default)]
    track: OneOrMany,
    #[serde(rename = "@attr")]
    attr: Attr,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum OneOrMany {
    Many(Vec<Item>),
    One(Box<Item>),
}

impl Default for OneOrMany {
    fn default() -> Self {
        Self::Many(Vec::new())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Attr {
    total_pages: String,
    total: String,
}

#[derive(Deserialize)]
struct Item {
    name: String,
    #[serde(default)]
    mbid: String,
    artist: Artist,
    date: Date,
}

#[derive(Deserialize)]
struct Artist {
    name: String,
}

#[derive(Deserialize)]
struct Date {
    uts: String,
}

pub fn parse_page(json: &str) -> Result<Page> {
    let tracks = serde_json::from_str::<Envelope>(json).context("reading a Last.fm loved-tracks page")?.lovedtracks;
    let items = match tracks.track {
        OneOrMany::Many(items) => items,
        OneOrMany::One(item) => vec![*item],
    };
    let items = items
        .into_iter()
        .map(|item| {
            Ok(Loved {
                track: item.name,
                artist: item.artist.name,
                recording_mbid: Some(item.mbid).filter(|mbid| !mbid.is_empty()),
                at: item.date.uts.parse().context("a loved track with a date that is not a number")?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(Page { items, total_pages: tracks.attr.total_pages.parse().context("totalPages")?, total: tracks.attr.total.parse().context("total")? })
}

/// Every page from `get(number)` (landing each through `land`) until the total Last.fm announced is in hand.
/// Fewer tracks than announced is a partial answer, and nothing is returned for it.
pub fn fetch_all(mut get: impl FnMut(u32) -> Result<String>, mut land: impl FnMut(u32, &str) -> Result<()>) -> Result<Vec<Loved>> {
    let mut items = Vec::new();
    let mut number = 1;
    loop {
        let text = crate::lastfm::get_page(&mut get, &mut std::thread::sleep, number)?;
        land(number, &text)?;
        let page = parse_page(&text)?;
        items.extend(page.items);
        if number >= page.total_pages {
            if items.len() != page.total {
                bail!("Last.fm announced {} loved tracks and gave {}", page.total, items.len());
            }
            return Ok(items);
        }
        number += 1;
    }
}

/// A loved track as a row: Last.fm's recording id, else the one the listens carry for that artist and track.
/// A track neither knows has nothing to key on and is left out.
fn to_feedback(known: &Known, loved: &Loved) -> Option<Feedback> {
    let heard = known.get(&(loved.artist.to_lowercase(), loved.track.to_lowercase()));
    let recording_mbid = loved.recording_mbid.clone().or_else(|| heard.map(|(mbid, _)| mbid.clone()))?;
    Some(Feedback {
        recording_mbid,
        score: 1,
        created_at: loved.at,
        track_name: Some(loved.track.clone()),
        artist_name: Some(loved.artist.clone()),
        release_name: heard.and_then(|(_, release)| release.clone()),
    })
}

/// What is stored for `items`: one row per recording, the newest feedback on it.
fn newest_per_recording(items: &[Feedback]) -> Vec<&Feedback> {
    let mut newest: std::collections::BTreeMap<&str, &Feedback> = std::collections::BTreeMap::new();
    for item in items {
        if newest.get(item.recording_mbid.as_str()).is_none_or(|kept| item.created_at >= kept.created_at) {
            newest.insert(item.recording_mbid.as_str(), item);
        }
    }
    newest.into_values().collect()
}

pub fn replace_all(db: &SqliteClient, items: &[Feedback]) -> Result<()> {
    let rows = newest_per_recording(items).into_iter().map(|item| {
        vec![json!(item.recording_mbid), json!(item.score), json!(item.created_at), json!(item.track_name), json!(item.artist_name), json!(item.release_name)]
    });
    let mut batch = vec![(SQL_CLEAR.to_string(), Vec::new())];
    batch.extend(insert_statements("INSERT OR REPLACE INTO", "recording_feedback", COLUMNS, rows));
    db.execute_batch(&batch).context("replacing the feedback")
}

fn land(directory: &Path, number: u32, text: &str) -> Result<()> {
    let path = directory.join(format!("page-{number:05}.json"));
    std::fs::write(&path, text).with_context(|| format!("writing {}", path.display()))
}

/// The `feedback` job: every track loved on Last.fm, replacing the table.
pub fn sync(db: &SqliteClient) -> Result<()> {
    let user = std::env::var("LASTFM_USER").context("LASTFM_USER is not set")?;
    let key = std::env::var("LASTFM_API_KEY").context("LASTFM_API_KEY is not set")?;
    let client = crate::listenbrainz::http_client()?;
    let page_at = |number: u32| -> Result<String> {
        let response = client
            .get(crate::lastfm::API_URL)
            .query(&[("method", "user.getlovedtracks"), ("user", user.as_str()), ("api_key", key.as_str()), ("format", "json"), ("limit", PAGE_SIZE), ("page", &number.to_string())])
            .send()
            .map_err(reqwest::Error::without_url)
            .context("asking Last.fm for loved tracks")?;
        response.text().map_err(reqwest::Error::without_url).context("reading the loved tracks")
    };
    // The table also takes recording ids from the listens, which change without a new love, so it is built from every
    // page once a day; between those, one page tells whether there is a love to add or remove.
    let today = chrono::Utc::now().date_naive();
    if crate::lastfm::landed_on("lastfm-loved", today)? {
        let first = parse_page(&page_at(1)?)?;
        let oldest = first.items.iter().map(|item| item.at).min().unwrap_or(0);
        let page: Vec<((String, String), i64)> = first.items.iter().map(|item| ((item.artist.clone(), item.track.clone()), item.at)).collect();
        let stored_count = db.query(SQL_LOVED_COUNT, &[])?.first().and_then(|row| row["count"].as_u64()).unwrap_or(0);
        let stored: Vec<((String, String), i64)> = db
            .query(SQL_LOVED_SINCE, &[json!(oldest)])?
            .iter()
            .map(|row| ((crate::entities::text(&row["artist_name"]), crate::entities::text(&row["track_name"])), row["loved_at"].as_i64().unwrap_or(0)))
            .collect();
        if crate::first_page::unchanged(&page, first.total, usize::try_from(stored_count).unwrap_or(usize::MAX), &stored) {
            println!("{} loved tracks on Last.fm, none loved or unloved since the last run", first.total);
            return Ok(());
        }
    }
    let directory = crate::lastfm::fresh_landing("lastfm-loved", today)?;
    let loved = fetch_all(page_at, |number, text| land(&directory, number, text))?;
    let known = load_known(db)?;
    let items = loved.iter().filter_map(|track| to_feedback(&known, track)).collect::<Vec<_>>();
    replace_all(db, &items)?;
    crate::likes::replace_loved(db, &loved)?;
    println!("{} loved tracks on Last.fm: {} stored, {} without a recording id left out", loved.len(), newest_per_recording(&items).len(), loved.len() - items.len());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn track(name: &str, mbid: &str, uts: i64) -> serde_json::Value {
        json!({ "name": name, "mbid": mbid, "artist": { "name": "PinkPantheress", "mbid": "" }, "date": { "uts": uts.to_string(), "#text": "x" } })
    }

    fn page(tracks: serde_json::Value, total_pages: u32, total: usize) -> String {
        json!({ "lovedtracks": { "track": tracks, "@attr": { "user": "u", "page": "1", "perPage": "200", "totalPages": total_pages.to_string(), "total": total.to_string() } } }).to_string()
    }

    fn database() -> SqliteClient {
        let db = SqliteClient::open(Path::new(":memory:")).unwrap();
        crate::schema::apply(&db).unwrap();
        db
    }

    #[test]
    fn parse_page_reads_the_real_shape_and_a_single_track_object() {
        let many = parse_page(&page(json!([track("Nice to know you", "m1", 100)]), 1, 1)).unwrap();
        let one = parse_page(&page(track("Nice to know you", "", 100), 1, 1)).unwrap();

        assert_eq!(many.items, vec![Loved { track: "Nice to know you".into(), artist: "PinkPantheress".into(), recording_mbid: Some("m1".into()), at: 100 }]);
        assert_eq!(one.items[0].recording_mbid, None);
    }

    #[test]
    fn fetch_all_walks_every_page_and_refuses_a_total_that_does_not_add_up() {
        let two_pages = |number: u32| Ok(page(json!([track(&format!("t{number}"), "", i64::from(number))]), 2, 2));
        assert_eq!(fetch_all(two_pages, |_, _| Ok(())).unwrap().len(), 2);

        let short = |_: u32| Ok(page(json!([track("t", "", 1)]), 1, 3));
        assert!(fetch_all(short, |_, _| Ok(())).is_err());
    }

    #[test]
    fn a_loved_track_without_an_id_borrows_the_one_its_listens_carry_and_is_left_out_if_there_is_none() {
        let db = database();
        db.execute("INSERT INTO listens (listened_at, track_name, artist_name, release_name, recording_mbid) VALUES (1, 'nice to know you', 'pinkpantheress', 'Fancy That', 'rec-1')", &[]).unwrap();
        let loved = |track: &str| Loved { track: track.into(), artist: "PinkPantheress".into(), recording_mbid: None, at: 9 };

        let known = load_known(&db).unwrap();
        let found = to_feedback(&known, &loved("Nice to know you")).unwrap();

        assert_eq!((found.recording_mbid.as_str(), found.release_name.as_deref()), ("rec-1", Some("Fancy That")));
        assert!(to_feedback(&known, &loved("Unknown")).is_none());
    }

    #[test]
    fn replace_all_makes_the_table_what_lastfm_says_now() {
        let db = database();
        let item = |mbid: &str, score| Feedback { recording_mbid: mbid.into(), score, created_at: 10, track_name: Some("T".into()), artist_name: None, release_name: None };
        replace_all(&db, &[item("a", 1), item("b", 1)]).unwrap();

        replace_all(&db, &[item("b", -1), item("c", 1)]).unwrap();

        let rows = db.query("SELECT recording_mbid, score FROM recording_feedback ORDER BY recording_mbid", &[]).unwrap();
        assert_eq!(rows, vec![json!({"recording_mbid": "b", "score": -1}), json!({"recording_mbid": "c", "score": 1})]);
    }

    #[test]
    fn a_recording_given_feedback_twice_keeps_the_newest_whatever_the_order() {
        let db = database();
        let item = |score, created_at| Feedback { recording_mbid: "same".into(), score, created_at, track_name: None, artist_name: None, release_name: None };

        replace_all(&db, &[item(-1, 300), item(1, 100), item(1, 200)]).unwrap();

        let rows = db.query("SELECT score, created_at FROM recording_feedback", &[]).unwrap();
        assert_eq!(rows, vec![json!({"score": -1, "created_at": 300})]);
    }

    #[test]
    fn a_score_that_is_neither_a_love_nor_a_hate_is_refused_by_the_table() {
        let db = database();
        let odd = Feedback { recording_mbid: "x".into(), score: 0, created_at: 1, track_name: None, artist_name: None, release_name: None };

        assert!(replace_all(&db, &[odd]).is_err());
    }
}
