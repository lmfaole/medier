//! The tracks the owner has saved on Spotify ("Liked Songs"), kept beside the listens. They live at Spotify and can
//! be removed there, so a run replaces the whole table with what Spotify says now; an answer that does not add
//! up to the total it announced is refused and changes nothing. A run first asks for one page, and when it shows
//! nothing added or removed (`first_page.rs`) the rest is not fetched. The pages are landed unchanged under
//! `.data/raw/spotify-saved/<date>/`.

use anyhow::{bail, Context, Result};
use serde::Deserialize;
use serde_json::json;
use shared_data::batch::insert_statements;
use shared_data::job::Job;
use shared_data::sqlite_client::SqliteClient;

use crate::spotify_api::{collect_pages, Page};

const PAGE_SIZE: usize = 50;
const SQL_CLEAR: &str = "DELETE FROM spotify_saved";
const SQL_COUNT: &str = "SELECT COUNT(*) AS count FROM spotify_saved";
const SQL_SINCE: &str = "SELECT spotify_id, added_at FROM spotify_saved WHERE added_at >= ?";
const COLUMNS: &[&str] = &["spotify_id", "isrc", "track_name", "artist_name", "album_name", "added_at"];

#[derive(Debug, PartialEq, Eq)]
pub struct Saved {
    pub spotify_id: String,
    pub isrc: Option<String>,
    pub track_name: String,
    /// Every credited artist, in order, joined with the unit separator (`\u{1f}`): the likes sync matches Last.fm's one string against them.
    pub artist_name: String,
    pub album_name: Option<String>,
    pub added_at: i64,
}

#[derive(Deserialize)]
struct Envelope {
    total: usize,
    items: Vec<Item>,
}

#[derive(Deserialize)]
struct Item {
    added_at: String,
    track: Option<Track>,
}

#[derive(Deserialize)]
struct Track {
    id: Option<String>,
    name: String,
    artists: Vec<Named>,
    album: Option<Named>,
    external_ids: Option<ExternalIds>,
}

#[derive(Deserialize)]
struct Named {
    name: String,
}

#[derive(Deserialize)]
struct ExternalIds {
    isrc: Option<String>,
}

/// One page. `count` is how many items Spotify sent, which is more than `items` when a local file or a withdrawn track has no id.
pub fn parse_page(json: &str) -> Result<Page<Saved>> {
    let page = serde_json::from_str::<Envelope>(json).context("reading a Spotify saved-tracks page")?;
    let count = page.items.len();
    let items = page
        .items
        .into_iter()
        .filter_map(|item| {
            let track = item.track?;
            let added_at = chrono::DateTime::parse_from_rfc3339(&item.added_at).ok()?.timestamp();
            Some(Saved {
                spotify_id: track.id?,
                isrc: track.external_ids.and_then(|ids| ids.isrc),
                track_name: track.name,
                artist_name: Some(track.artists.iter().map(|artist| artist.name.as_str()).collect::<Vec<_>>().join("\u{1f}")).filter(|joined| !joined.is_empty())?,
                album_name: track.album.map(|album| album.name).filter(|name| !name.is_empty()),
                added_at,
            })
        })
        .collect();
    Ok(Page { items, total: page.total, count })
}

pub fn fetch_all(get: impl FnMut(usize) -> Result<String>, land: impl FnMut(usize, &str) -> Result<()>) -> Result<Vec<Saved>> {
    collect_pages(PAGE_SIZE, "saved tracks", get, land, parse_page)
}

pub fn replace_all(db: &SqliteClient, items: &[Saved]) -> Result<()> {
    let rows = items
        .iter()
        .map(|item| vec![json!(item.spotify_id), json!(item.isrc), json!(item.track_name), json!(item.artist_name), json!(item.album_name), json!(item.added_at)]);
    let mut batch = vec![(SQL_CLEAR.to_string(), Vec::new())];
    batch.extend(insert_statements("INSERT OR REPLACE INTO", "spotify_saved", COLUMNS, rows));
    db.execute_batch(&batch).context("replacing the saved tracks")
}

/// Whether Spotify's first page says the library is the one stored (`first_page.rs`). A page with an item that has no
/// id (a local file) is never trusted, since such items are not stored to compare with.
pub fn unchanged(first: &Page<Saved>, stored_count: usize, stored_since: &[(String, i64)]) -> bool {
    let page: Vec<(String, i64)> = first.items.iter().map(|item| (item.spotify_id.clone(), item.added_at)).collect();
    first.count == first.items.len() && crate::first_page::unchanged(&page, first.total, stored_count, stored_since)
}

/// The `spotify-likes` job: every track saved on Spotify, replacing the table, unless the first page shows nothing changed.
pub fn sync(db: &SqliteClient) -> Result<()> {
    let http = crate::spotify_api::client()?;
    let token = crate::spotify_api::access_token(&http)?;
    let page_at = |offset: usize| crate::spotify_api::send(&http, &token, &reqwest::Method::GET, &format!("{}/me/tracks?limit={PAGE_SIZE}&offset={offset}", crate::spotify_api::API));
    // About 30 pages a run otherwise, landed again each time; one page tells whether any of it is new.
    let first = parse_page(&page_at(0)?)?;
    let stored_count = db.query(SQL_COUNT, &[])?.first().and_then(|row| row["count"].as_u64()).unwrap_or(0);
    let oldest = first.items.iter().map(|item| item.added_at).min().unwrap_or(0);
    let stored_since: Vec<(String, i64)> = db
        .query(SQL_SINCE, &[json!(oldest)])?
        .iter()
        .map(|row| (row["spotify_id"].as_str().unwrap_or_default().to_string(), row["added_at"].as_i64().unwrap_or(0)))
        .collect();
    if unchanged(&first, usize::try_from(stored_count).unwrap_or(usize::MAX), &stored_since) {
        println!("{} tracks saved on Spotify, none added or removed since the last run", first.total);
        return Ok(());
    }
    let directory = crate::lastfm::fresh_landing("spotify-saved", chrono::Utc::now().date_naive())?;
    let saved = fetch_all(
        page_at,
        |number, text| {
            let path = directory.join(format!("page-{number:05}.json"));
            std::fs::write(&path, text).with_context(|| format!("writing {}", path.display()))
        },
    )?;
    replace_all(db, &saved)?;
    println!("{} tracks saved on Spotify", saved.len());
    Ok(())
}

/// The jobs of the Spotify likes, which `main` adds to its own.
#[must_use]
pub fn jobs() -> Vec<Job<SqliteClient>> {
    vec![
        Job::new("spotify-likes", "replace the saved tracks with what Spotify says now", |db, _| sync(db)),
        Job::new("spotify-login-start", "print the Spotify approval address when the browser is not on this machine", |_, _| crate::spotify_api::start()),
        Job::new("spotify-login-finish", "finish that approval from the address the browser ended on: <address>", |_, args| crate::spotify_api::finish(args.positional(0))).takes(&["address"]),
        Job::new("lastfm-login-start", "print the Last.fm approval address", |_, _| crate::lastfm_love::start()),
        Job::new("lastfm-login-finish", "keep the Last.fm session once the address was approved", |_, _| crate::lastfm_love::finish()),
        Job::new("likes-auth", "sign in once to a service whose likes are written: <service: spotify>", |_, args| match args.positional(0) {
            "spotify" => crate::spotify_api::login(),
            other => bail!("«{other}» is not a service to sign in to here (spotify); Last.fm has lastfm-login-start"),
        })
        .takes(&["service"]),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: Option<&str>, name: &str, artists: &[&str]) -> serde_json::Value {
        json!({
            "added_at": "2024-03-01T12:00:00Z",
            "track": { "id": id, "name": name, "artists": artists.iter().map(|name| json!({ "name": name })).collect::<Vec<_>>(), "album": { "name": "Album" }, "external_ids": { "isrc": "USX" } }
        })
    }

    fn page(items: &[serde_json::Value], total: usize) -> String {
        json!({ "total": total, "items": items }).to_string()
    }

    #[test]
    fn a_page_joins_the_artists_and_drops_what_has_no_id() {
        let local = json!({ "added_at": "2024-03-01T12:00:00Z", "track": null });
        let parsed = parse_page(&page(&[item(Some("t1"), "Song", &["A", "B"]), item(None, "Local", &["A"]), local], 3)).unwrap();
        assert_eq!(parsed.count, 3);
        assert_eq!(parsed.items.len(), 1);
        assert_eq!((parsed.items[0].artist_name.as_str(), parsed.items[0].added_at), ("A\u{1f}B", 1_709_294_400));
    }

    #[test]
    fn fewer_tracks_than_announced_is_refused_and_a_complete_answer_is_kept() {
        let mut short = vec![page(&[], 2), page(&[item(Some("t1"), "Song", &["A"])], 2)];
        assert!(fetch_all(|_| Ok(short.pop().unwrap_or_default()), |_, _| Ok(())).is_err());
        let mut pages = vec![page(&[item(Some("t2"), "Two", &["A"])], 2), page(&[item(Some("t1"), "One", &["A"])], 2)];
        let all = fetch_all(|_| Ok(pages.pop().unwrap_or_default()), |_, _| Ok(())).unwrap();
        assert_eq!(all.iter().map(|saved| saved.spotify_id.as_str()).collect::<Vec<_>>(), ["t1", "t2"]);
    }

    #[test]
    fn a_page_with_a_local_file_never_counts_as_unchanged() {
        let at = 1_709_294_400;
        let with_local = parse_page(&page(&[item(Some("t2"), "Two", &["A"]), item(None, "Local", &["A"])], 2)).unwrap();
        assert!(!unchanged(&with_local, 2, &[("t2".to_string(), at)]));
        let whole = parse_page(&page(&[item(Some("t2"), "Two", &["A"])], 1)).unwrap();
        assert!(unchanged(&whole, 1, &[("t2".to_string(), at)]));
    }
}
