//! The favourite photos and videos of each concert's Immich album, as small pictures the music app can show without asking Immich: the
//! album ids come from `music_concert_event`, Immich is asked for the album's favourites (`POST /search/metadata`) and each
//! one's thumbnail (`GET /assets/<id>/thumbnail`) is kept as a file in `.data/concert-photos/` (`MUSIC_CONCERT_PHOTOS`). An album shows
//! eighteen pictures: its favourites first, and what is missing of eighteen from its other pictures taken after the concert began, spread over
//! the time that follows. A video is kept as the picture Immich makes of it, marked as a video.
//! A picture already kept is not fetched again, and one that is no longer shown leaves the table but not the folder. An album Immich
//! does not answer for keeps the photos it had. The key is `IMMICH_API_KEY` of `~/.config/immich-sync.env`, which may read assets.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use chrono::{Local, NaiveDate, NaiveTime, SecondsFormat, TimeZone};
use serde_json::{json, Value};
use shared_data::app_db::path_from_env;
use shared_data::batch::insert_statements;
use shared_data::http::client;
use shared_data::sqlite_client::SqliteClient;

/// How many pictures an album shows, the favourites first.
const PHOTOS_PER_ALBUM: usize = 18;

/// How many of the pictures after the start the others are chosen from, so that they are spread over the whole evening.
const POOL: usize = 200;

const SQL_ALBUMS: &str = "SELECT album_id, MIN(on_date) AS on_date, MIN(at_time) AS at_time FROM (SELECT album_id, on_date, at_time FROM music_concert_event UNION ALL SELECT album_id, watched_on, NULL FROM music_concert_album) WHERE album_id IS NOT NULL GROUP BY album_id";
const SQL_FORGET: &str = "DELETE FROM music_concert_media WHERE album_id = ?";

/// Where Immich is and the key to it: the environment, else the file the Nextcloud repository's scripts read.
fn immich() -> Result<(String, String)> {
    let mut found: HashMap<String, String> = ["IMMICH_URL", "IMMICH_API_KEY"].iter().filter_map(|name| Some((name.to_string(), std::env::var(name).ok()?))).collect();
    if found.len() < 2 {
        let file = PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".config/immich-sync.env");
        let text = std::fs::read_to_string(&file).with_context(|| format!("IMMICH_URL and IMMICH_API_KEY are not set and {} could not be read", file.display()))?;
        for line in text.lines() {
            if let Some((name, value)) = line.split_once('=') {
                found.entry(name.trim().to_string()).or_insert_with(|| value.trim().trim_matches('"').to_string());
            }
        }
    }
    let url = found.get("IMMICH_URL").context("IMMICH_URL is not set")?.trim_end_matches('/').to_string();
    Ok((url, found.get("IMMICH_API_KEY").context("IMMICH_API_KEY is not set")?.clone()))
}

/// A picture or a video of an album.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Item {
    pub id: String,
    pub video: bool,
}

/// The assets an Immich search answered with, oldest first.
#[must_use]
pub fn items(answer: &Value) -> Vec<Item> {
    answer["assets"]["items"]
        .as_array()
        .map(|items| items.iter().filter_map(|item| Some(Item { id: item["id"].as_str()?.to_string(), video: item["type"] == "VIDEO" })).collect())
        .unwrap_or_default()
}

/// The moment the concert begins, as Immich wants it (UTC): the day and time of the calendar in this machine's time, the start of
/// the day for a concert with no time.
#[must_use]
pub fn starts_at(day: &str, time: Option<&str>) -> Option<String> {
    let day = NaiveDate::parse_from_str(day, "%Y-%m-%d").ok()?;
    let time = time.map_or(Some(NaiveTime::MIN), |time| NaiveTime::parse_from_str(time, "%H:%M").ok())?;
    let start = Local.from_local_datetime(&day.and_time(time)).earliest()?;
    Some(start.to_utc().to_rfc3339_opts(SecondsFormat::Secs, true))
}

/// `count` of `ids` spread evenly over them, in order, so that a burst of one moment is not the whole choice.
#[must_use]
pub fn spread(ids: &[Item], count: usize) -> Vec<Item> {
    if ids.len() <= count {
        return ids.to_vec();
    }
    (0..count).map(|slot| ids[slot * ids.len() / count].clone()).collect()
}

/// The extension of the picture an answer of this content type is: Immich's thumbnails are WebP unless it is set to JPEG.
#[must_use]
pub fn extension(content_type: &str) -> Option<&'static str> {
    match content_type.split(';').next()?.trim() {
        "image/webp" => Some("webp"),
        "image/jpeg" => Some("jpg"),
        _ => None,
    }
}

/// The file of an asset already kept in `directory`, whatever its extension.
fn kept(directory: &Path, asset: &str) -> Option<String> {
    ["webp", "jpg"].iter().map(|ext| format!("{asset}.{ext}")).find(|name| directory.join(name).is_file())
}

fn fetch(http: &reqwest::blocking::Client, url: &str, key: &str, directory: &Path, asset: &str) -> Result<String> {
    if let Some(name) = kept(directory, asset) {
        return Ok(name);
    }
    let response = http.get(format!("{url}/api/assets/{asset}/thumbnail?size=thumbnail")).header("x-api-key", key).send()?.error_for_status().with_context(|| format!("the thumbnail of {asset}"))?;
    let content_type = response.headers().get("content-type").and_then(|value| value.to_str().ok()).unwrap_or_default().to_string();
    let ext = extension(&content_type).with_context(|| format!("the thumbnail of {asset} is {content_type}, not WebP or JPEG"))?;
    let name = format!("{asset}.{ext}");
    std::fs::write(directory.join(&name), response.bytes()?).with_context(|| format!("writing {name}"))?;
    Ok(name)
}

/// What an Immich search of an album answers with, as an error where it did not.
fn search(http: &reqwest::blocking::Client, url: &str, key: &str, body: &Value) -> Result<Value> {
    Ok(http.post(format!("{url}/api/search/metadata")).header("x-api-key", key).json(body).send()?.error_for_status()?.json::<Value>()?)
}

/// `total` photos: the favourites, then what is missing of `total` from the other pictures (`others`), spread over them. A picture that is
/// a favourite is not chosen twice.
#[must_use]
pub fn fill(favourites: Vec<Item>, others: &[Item], total: usize) -> Vec<Item> {
    let mut photos = favourites;
    photos.truncate(total);
    let rest: Vec<Item> = others.iter().filter(|item| !photos.iter().any(|kept| kept.id == item.id)).cloned().collect();
    photos.extend(spread(&rest, total - photos.len()));
    photos
}

/// The picture the owner made the album's cover in Immich (`Use as album cover`), which is the head of the concert's page.
fn cover(http: &reqwest::blocking::Client, url: &str, key: &str, album: &str) -> Result<Option<Item>> {
    let get = |path: String| -> Result<Value> { Ok(http.get(format!("{url}/api{path}")).header("x-api-key", key).send()?.error_for_status()?.json::<Value>()?) };
    let Some(id) = get(format!("/albums/{album}?withoutAssets=true"))?["albumThumbnailAssetId"].as_str().map(str::to_string) else { return Ok(None) };
    let video = get(format!("/assets/{id}"))?["type"] == "VIDEO";
    Ok(Some(Item { id, video }))
}

/// `photos` with `cover` first, once, and no more than `total` of them.
#[must_use]
pub fn with_cover(mut photos: Vec<Item>, cover: Option<Item>, total: usize) -> Vec<Item> {
    if let Some(cover) = cover {
        photos.retain(|photo| photo.id != cover.id);
        photos.insert(0, cover);
    }
    photos.truncate(total);
    photos
}

/// The photos an album shows: its cover, its favourites, then others from the start of the concert on until there are eighteen.
fn chosen(http: &reqwest::blocking::Client, url: &str, key: &str, album: &str, start: Option<&str>) -> Result<Vec<Item>> {
    let cover = cover(http, url, key, album)?;
    let favourite = items(&search(http, url, key, &json!({ "albumIds": [album], "isFavorite": true, "visibility": "timeline", "order": "asc", "size": PHOTOS_PER_ALBUM }))?);
    let Some(start) = start.filter(|_| favourite.len() < PHOTOS_PER_ALBUM) else { return Ok(with_cover(favourite, cover, PHOTOS_PER_ALBUM)) };
    // `timeline` leaves out the hidden half of a Live Photo, which is a video of three seconds.
    let after = items(&search(http, url, key, &json!({ "albumIds": [album], "visibility": "timeline", "takenAfter": start, "order": "asc", "size": POOL }))?);
    Ok(with_cover(fill(favourite, &after, PHOTOS_PER_ALBUM), cover, PHOTOS_PER_ALBUM))
}

/// The `concert-photos` job.
pub fn run(db: &SqliteClient) -> Result<()> {
    let (url, key) = immich()?;
    let directory = path_from_env("MUSIC_CONCERT_PHOTOS", "../../.data/concert-photos");
    std::fs::create_dir_all(&directory).with_context(|| format!("making {}", directory.display()))?;
    let http = client("music-sync")?;
    let (mut albums, mut photos) = (0, 0);
    for row in db.query(SQL_ALBUMS, &[])? {
        let Some(album) = row["album_id"].as_str() else { continue };
        let start = starts_at(row["on_date"].as_str().unwrap_or_default(), row["at_time"].as_str());
        let assets = match chosen(&http, &url, &key, album, start.as_deref()) {
            Ok(assets) => assets,
            Err(error) => {
                eprintln!("concert-photos: album {album} was not answered: {error:#}");
                continue;
            }
        };
        let mut rows = Vec::new();
        for (position, asset) in assets.iter().enumerate() {
            match fetch(&http, &url, &key, &directory, &asset.id) {
                Ok(file) => rows.push(vec![json!(asset.id), json!(album), json!(position), json!(file), json!(i64::from(asset.video))]),
                Err(error) => eprintln!("concert-photos: {error:#}"),
            }
        }
        let mut batch = vec![(SQL_FORGET.to_string(), vec![json!(album)])];
        batch.extend(insert_statements("INSERT OR REPLACE INTO", "music_concert_media", &["asset_id", "album_id", "position", "file", "is_video"], rows.iter().cloned()));
        db.execute_batch(&batch).with_context(|| format!("replacing the photos of album {album}"))?;
        albums += 1;
        photos += rows.len();
    }
    println!("concert-photos: {photos} photos of {albums} albums");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, video: bool) -> Item {
        Item { id: id.to_string(), video }
    }

    fn photos(names: &[&str]) -> Vec<Item> {
        names.iter().map(|name| item(name, false)).collect()
    }

    #[test]
    fn the_cover_comes_first_once_and_the_choice_stays_within_the_total() {
        let ids = |items: Vec<Item>| items.into_iter().map(|item| item.id).collect::<Vec<_>>();
        assert_eq!(ids(with_cover(photos(&["a", "b", "c"]), Some(item("c", false)), 3)), ["c", "a", "b"]);
        assert_eq!(ids(with_cover(photos(&["a", "b"]), Some(item("z", false)), 2)), ["z", "a"]);
        assert_eq!(ids(with_cover(photos(&["a"]), None, 2)), ["a"]);
    }

    #[test]
    fn the_items_are_the_ids_of_the_answer_in_its_order_with_the_videos_marked() {
        let answer = json!({ "assets": { "items": [{ "id": "b", "type": "VIDEO" }, { "id": "a", "type": "IMAGE" }], "nextPage": null } });
        assert_eq!(items(&answer), vec![item("b", true), item("a", false)]);
        assert!(items(&json!({ "message": "no" })).is_empty());
    }

    #[test]
    fn the_pictures_after_the_start_are_spread_over_the_time_not_the_first_burst() {
        let ids = photos(&["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]);
        assert_eq!(spread(&ids, 6), photos(&["0", "2", "4", "6", "8", "10"]));
        assert_eq!(spread(&ids[..4], 6), photos(&["0", "1", "2", "3"]));
    }

    #[test]
    fn the_favourites_come_first_and_the_rest_is_spread_without_repeating_them() {
        let others = photos(&["a", "b", "c", "d", "e", "f", "g", "h"]);
        let favourites = vec![item("c", false), item("x", true)];
        assert_eq!(fill(favourites, &others, 5), vec![item("c", false), item("x", true), item("a", false), item("d", false), item("f", false)]);
        assert_eq!(fill(vec![], &others[..3], 9), photos(&["a", "b", "c"]));
        assert_eq!(fill(photos(&["1", "2", "3"]), &others, 3), photos(&["1", "2", "3"]));
    }

    #[test]
    fn the_start_is_the_calendar_day_and_time_or_the_start_of_the_day() {
        assert!(starts_at("2026-02-25", Some("19:00")).is_some_and(|start| start.ends_with('Z')));
        assert!(starts_at("2026-02-25", None).is_some());
        assert_eq!(starts_at("not a day", None), None);
    }

    #[test]
    fn only_webp_and_jpeg_are_kept_as_pictures() {
        assert_eq!(extension("image/webp"), Some("webp"));
        assert_eq!(extension("image/jpeg; charset=binary"), Some("jpg"));
        assert_eq!(extension("text/html"), None);
    }
}
