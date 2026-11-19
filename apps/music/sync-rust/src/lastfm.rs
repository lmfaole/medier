//! Last.fm scrobbles into `listens`. `fetch-lastfm` lands every page of
//! `user.getRecentTracks` unchanged under `.data/raw/lastfm/<date>/`, and
//! `import-lastfm` reads a landed folder, so the original is kept whatever the
//! import decides. Last.fm carries MusicBrainz ids for many tracks, which fills
//! genre, decade and area where the Spotify import has none.

use std::path::Path;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use serde::Deserialize;
use shared_data::sqlite_client::SqliteClient;

use crate::models::Listen;
use crate::resolve::Found;
use crate::spotify::year_of;
use crate::sync::insert_listens;
use crate::twins::Existing;

pub const API_URL: &str = "https://ws.audioscrobbler.com/2.0/";
const PAGE_SIZE: &str = "200";
/// Last.fm's own "try again" answers: 8 operation failed (backend), 11 service offline,
/// 16 temporarily unavailable, 29 rate limit.
const RETRYABLE: [i64; 4] = [8, 11, 16, 29];

/// Whether an answer is worth asking for again: not JSON at all (an error page from the edge), or one of the
/// "try again" errors.
pub fn is_transient(text: &str) -> bool {
    match serde_json::from_str::<serde_json::Value>(text) {
        Err(_) => true,
        Ok(_) => api_error(text).is_some_and(|(code, _)| is_retryable(code)),
    }
}

/// Whether Last.fm's error code means "ask again later".
pub fn is_retryable(code: i64) -> bool {
    RETRYABLE.contains(&code)
}
const MAX_RATE_LIMIT_RETRIES: u32 = 8;
const RATE_LIMIT_WAIT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Scrobble {
    pub listened_at: i64,
    pub track: String,
    pub artist: String,
    pub album: Option<String>,
    pub recording_mbid: Option<String>,
    pub artist_mbid: Option<String>,
    pub release_mbid: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Page {
    pub scrobbles: Vec<Scrobble>,
    pub total_pages: u32,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Counts {
    pub read: usize,
    pub already_listened: usize,
    pub per_year_added: Vec<(i32, usize)>,
}

pub struct Plan {
    pub listens: Vec<Listen>,
    pub counts: Counts,
}

#[derive(Deserialize)]
struct Envelope {
    recenttracks: Option<RecentTracks>,
}

#[derive(Deserialize)]
struct RecentTracks {
    track: Option<OneOrMany<Item>>,
    #[serde(rename = "@attr")]
    attr: Option<PageAttr>,
}

#[derive(Deserialize)]
struct PageAttr {
    #[serde(rename = "totalPages")]
    total_pages: String,
}

/// Last.fm answers an object, not a one-element array, when a page holds one track.
#[derive(Deserialize)]
#[serde(untagged)]
enum OneOrMany<T> {
    Many(Vec<T>),
    One(T),
}

#[derive(Deserialize)]
struct Item {
    artist: Named,
    name: String,
    #[serde(default)]
    mbid: String,
    album: Option<Named>,
    date: Option<DateAttr>,
    #[serde(rename = "@attr")]
    attr: Option<ItemAttr>,
}

#[derive(Deserialize)]
struct Named {
    #[serde(rename = "#text", default)]
    text: String,
    #[serde(default)]
    mbid: String,
}

#[derive(Deserialize)]
struct DateAttr {
    uts: String,
}

#[derive(Deserialize)]
struct ItemAttr {
    nowplaying: Option<String>,
}

#[derive(Deserialize)]
struct TrackInfoEnvelope {
    track: Option<TrackInfo>,
}

#[derive(Deserialize)]
struct TrackInfo {
    name: String,
    #[serde(default)]
    mbid: String,
    artist: TrackInfoArtist,
    album: Option<TrackInfoAlbum>,
}

#[derive(Deserialize)]
struct TrackInfoArtist {
    name: String,
    #[serde(default)]
    mbid: String,
}

#[derive(Deserialize)]
struct TrackInfoAlbum {
    #[serde(default)]
    mbid: String,
}

/// What `track.getInfo` (with `autocorrect`) says about a track: the ids and the spelling Last.fm
/// has, or `None` when it does not know the track or has no recording id for it. Error 6 is "not found";
/// any other error is returned for the caller to retry or stop on.
pub fn parse_track_info(json: &str) -> Result<Option<Found>> {
    if let Some((code, message)) = api_error(json) {
        if code == 6 {
            return Ok(None);
        }
        bail!("Last.fm error {code}: {message}");
    }
    let envelope: TrackInfoEnvelope = serde_json::from_str(json).context("reading Last.fm's track info")?;
    let Some(track) = envelope.track else { return Ok(None) };
    let Some(recording_mbid) = none_if_empty(track.mbid) else { return Ok(None) };
    Ok(Some(Found {
        recording_mbid,
        artist_mbid: none_if_empty(track.artist.mbid),
        release_mbid: track.album.and_then(|album| none_if_empty(album.mbid)),
        title: track.name,
        credited: vec![track.artist.name.clone()],
        artist_credit: track.artist.name,
        score: 100,
    }))
}

fn none_if_empty(text: String) -> Option<String> {
    (!text.trim().is_empty()).then_some(text)
}

pub fn parse_page(json: &str) -> Result<Page> {
    let envelope: Envelope = serde_json::from_str(json).context("reading a Last.fm page")?;
    let Some(recent) = envelope.recenttracks else {
        bail!("the answer has no recenttracks");
    };
    let total_pages = recent.attr.map_or(Ok(0), |attr| attr.total_pages.parse()).context("reading totalPages")?;
    let items = match recent.track {
        None => Vec::new(),
        Some(OneOrMany::Many(items)) => items,
        Some(OneOrMany::One(item)) => vec![item],
    };
    let mut scrobbles = Vec::new();
    for item in items {
        let playing = item.attr.and_then(|attr| attr.nowplaying).is_some_and(|flag| flag == "true");
        // A track being played now has no time yet; a scrobble without one cannot be placed.
        let Some(date) = item.date.filter(|_| !playing) else { continue };
        scrobbles.push(Scrobble {
            listened_at: date.uts.parse().context("reading a scrobble time")?,
            track: item.name,
            artist: item.artist.text,
            album: item.album.as_ref().and_then(|album| none_if_empty(album.text.clone())),
            recording_mbid: none_if_empty(item.mbid),
            artist_mbid: none_if_empty(item.artist.mbid),
            release_mbid: item.album.and_then(|album| none_if_empty(album.mbid)),
        });
    }
    Ok(Page { scrobbles, total_pages })
}

/// `Some((code, message))` when Last.fm answered with an error object instead of a page.
pub fn api_error(json: &str) -> Option<(i64, String)> {
    let value: serde_json::Value = serde_json::from_str(json).ok()?;
    let code = value.get("error")?.as_i64()?;
    let message = value.get("message").and_then(|message| message.as_str()).unwrap_or_default();
    Some((code, message.to_string()))
}

pub fn plan_import(scrobbles: &[Scrobble], existing: &mut Existing) -> Plan {
    let mut counts = Counts { read: scrobbles.len(), ..Counts::default() };
    let mut per_year: std::collections::BTreeMap<i32, usize> = std::collections::BTreeMap::new();
    let mut listens = Vec::new();
    for scrobble in scrobbles {
        if existing.has_twin(&scrobble.track, scrobble.listened_at) {
            counts.already_listened += 1;
            continue;
        }
        existing.add(&scrobble.track, scrobble.listened_at);
        *per_year.entry(year_of(scrobble.listened_at)).or_default() += 1;
        listens.push(Listen {
            listened_at: scrobble.listened_at,
            track_name: scrobble.track.clone(),
            artist_name: scrobble.artist.clone(),
            release_name: scrobble.album.clone(),
            recording_mbid: scrobble.recording_mbid.clone(),
            artist_mbid: scrobble.artist_mbid.clone(),
            release_mbid: scrobble.release_mbid.clone(),
            duration_ms: None,
        });
    }
    counts.per_year_added = per_year.into_iter().collect();
    Plan { listens, counts }
}

/// Asks for page `start`, `start + 1` … up to the `totalPages` the first answer announces, and
/// hands each answer to `land` as received. A rate limit or a backend hiccup is waited out and the
/// page asked again. Page 1 is `start` for a new pull; a resumed one starts after the pages it has.
pub fn fetch_pages(
    start: u32,
    mut get: impl FnMut(u32) -> Result<String>,
    mut sleep: impl FnMut(Duration),
    mut land: impl FnMut(u32, &str) -> Result<()>,
) -> Result<u32> {
    let mut total: Option<u32> = None;
    let mut number = start;
    let mut landed = 0;
    while total.is_none_or(|total| number <= total) {
        let text = get_page(&mut get, &mut sleep, number)?;
        let page = parse_page(&text)?;
        if total.is_none() {
            total = Some(page.total_pages);
            if page.total_pages < number {
                break;
            }
        }
        land(number, &text)?;
        landed += 1;
        number += 1;
    }
    Ok(landed)
}

pub fn get_page(get: &mut impl FnMut(u32) -> Result<String>, sleep: &mut impl FnMut(Duration), number: u32) -> Result<String> {
    let mut waits = 0;
    loop {
        let text = get(number)?;
        match api_error(&text) {
            None => return Ok(text),
            Some((code, _)) if RETRYABLE.contains(&code) && waits < MAX_RATE_LIMIT_RETRIES => {
                waits += 1;
                sleep(RATE_LIMIT_WAIT);
            }
            Some((code, message)) => bail!("Last.fm error {code}: {message}"),
        }
    }
}

/// Lands every page of the user's scrobbles in `directory`, read-only. The key is
/// in the request only, never in a landed page or an error message.
pub fn fetch(directory: &Path, from: Option<i64>) -> Result<()> {
    let user = std::env::var("LASTFM_USER").context("LASTFM_USER is not set")?;
    let key = std::env::var("LASTFM_API_KEY").context("LASTFM_API_KEY is not set")?;
    let client = crate::listenbrainz::http_client()?;
    let from = from.map(|seconds| seconds.to_string());
    let get = |number: u32| -> Result<String> {
        let mut request = client
            .get(API_URL)
            .query(&[("method", "user.getrecenttracks"), ("user", user.as_str()), ("api_key", key.as_str()), ("format", "json"), ("limit", PAGE_SIZE), ("page", &number.to_string())]);
        if let Some(from) = &from {
            request = request.query(&[("from", from.as_str())]);
        }
        let response = request
            .send()
            .map_err(reqwest::Error::without_url)
            .context("asking Last.fm")?;
        response.text().map_err(reqwest::Error::without_url).context("reading the Last.fm answer")
    };
    let land = |number: u32, text: &str| -> Result<()> {
        let path = directory.join(format!("page-{number:05}.json"));
        std::fs::write(&path, text).with_context(|| format!("writing {}", path.display()))?;
        let mut permissions = std::fs::metadata(&path)?.permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(&path, permissions).with_context(|| format!("protecting {}", path.display()))
    };
    let first = next_page(directory)?;
    if first > 1 {
        println!("resuming after page {} in {}", first - 1, directory.display());
    }
    let landed = fetch_pages(first, get, std::thread::sleep, land)?;
    println!("landed {landed} pages of scrobbles for {user} in {}", directory.display());
    Ok(())
}

/// Whether anything of `source` was landed on `date` (the first landing of a day is `<date>/`, later ones `<date>-<n>/`).
pub fn landed_on(source: &str, date: chrono::NaiveDate) -> Result<bool> {
    let base = shared_data::raw::landing_path(source, date)?;
    Ok(std::fs::read_dir(&base).is_ok_and(|mut entries| entries.next().is_some()))
}

/// A folder for one recent pull: today's, or the first `-2`, `-3` … that is still empty, because a landed
/// original is never added to and a second pull on the same day is a new folder.
pub fn fresh_landing(source: &str, date: chrono::NaiveDate) -> Result<std::path::PathBuf> {
    let base = shared_data::raw::landing_path(source, date)?;
    for suffix in 1.. {
        let candidate = if suffix == 1 { base.clone() } else { base.with_file_name(format!("{date}-{suffix}")) };
        let empty = std::fs::read_dir(&candidate).map_or(true, |mut entries| entries.next().is_none());
        if empty {
            std::fs::create_dir_all(&candidate).with_context(|| format!("creating {}", candidate.display()))?;
            return Ok(candidate);
        }
    }
    unreachable!("the loop only ends by returning")
}

/// The page after the highest `page-NNNNN.json` already in `directory`, 1 for a new pull.
fn next_page(directory: &Path) -> Result<u32> {
    let mut highest = 0;
    for entry in std::fs::read_dir(directory).with_context(|| format!("reading {}", directory.display()))? {
        let name = entry?.file_name();
        let number = name.to_str().and_then(|name| name.strip_prefix("page-")).and_then(|rest| rest.strip_suffix(".json")).and_then(|digits| digits.parse::<u32>().ok());
        highest = highest.max(number.unwrap_or(0));
    }
    Ok(highest + 1)
}

fn read_scrobbles(directory: &Path) -> Result<Vec<Scrobble>> {
    let mut files: Vec<_> = std::fs::read_dir(directory)
        .with_context(|| format!("reading {}", directory.display()))?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| {
            path.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.starts_with("page-"))
                && path.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("json"))
        })
        .collect();
    files.sort();
    let mut scrobbles = Vec::new();
    for file in files {
        let text = std::fs::read_to_string(&file).with_context(|| format!("reading {}", file.display()))?;
        scrobbles.extend(parse_page(&text).with_context(|| file.display().to_string())?.scrobbles);
    }
    Ok(scrobbles)
}

pub fn import(db: &SqliteClient, directory: &Path, dry_run: bool) -> Result<()> {
    let scrobbles = read_scrobbles(directory)?;
    let mut existing = Existing::load(db).context("reading the stored listens")?;
    let Plan { listens, counts } = plan_import(&scrobbles, &mut existing);
    let with_ids = listens.iter().filter(|listen| listen.recording_mbid.is_some()).count();

    println!("read {} scrobbles: {} already in listens, {} to add ({with_ids} with a MusicBrainz recording id)", counts.read, counts.already_listened, listens.len());
    for (year, added) in &counts.per_year_added {
        println!("  {year}: {added} to add");
    }
    if dry_run {
        println!("dry run: nothing written");
        return Ok(());
    }
    insert_listens(db, &listens).context("writing the listens")?;
    println!("added {} listens", listens.len());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn page(tracks: serde_json::Value, total_pages: u32) -> String {
        json!({ "recenttracks": { "track": tracks, "@attr": { "user": "snowpony69", "page": "1", "perPage": "200", "totalPages": total_pages.to_string(), "total": "3" } } }).to_string()
    }

    fn track(name: &str, artist: &str, uts: i64) -> serde_json::Value {
        json!({
            "artist": { "mbid": "a-mbid", "#text": artist },
            "name": name,
            "mbid": "t-mbid",
            "album": { "mbid": "r-mbid", "#text": "An Album" },
            "date": { "uts": uts.to_string(), "#text": "01 Jan 2010, 12:00" },
            "streamable": "0"
        })
    }

    fn scrobble(track: &str, at: i64) -> Scrobble {
        Scrobble { listened_at: at, track: track.into(), artist: "Artist".into(), album: None, recording_mbid: None, artist_mbid: None, release_mbid: None }
    }

    #[test]
    fn parse_page_reads_the_real_shape() {
        let parsed = parse_page(&page(json!([track("Song", "Artist", 1_262_347_200)]), 7)).unwrap();

        assert_eq!(parsed.total_pages, 7);
        assert_eq!(
            parsed.scrobbles,
            vec![Scrobble {
                listened_at: 1_262_347_200,
                track: "Song".into(),
                artist: "Artist".into(),
                album: Some("An Album".into()),
                recording_mbid: Some("t-mbid".into()),
                artist_mbid: Some("a-mbid".into()),
                release_mbid: Some("r-mbid".into()),
            }]
        );
    }

    #[test]
    fn a_single_track_is_an_object_not_an_array() {
        let parsed = parse_page(&page(track("Only", "Artist", 1_000_000), 1)).unwrap();

        assert_eq!(parsed.scrobbles.len(), 1);
    }

    #[test]
    fn a_now_playing_item_is_skipped() {
        let playing = json!({ "artist": { "mbid": "", "#text": "Artist" }, "name": "Now", "mbid": "", "album": { "mbid": "", "#text": "" }, "@attr": { "nowplaying": "true" } });
        let parsed = parse_page(&page(json!([playing, track("Done", "Artist", 1_000_000)]), 1)).unwrap();

        assert_eq!(parsed.scrobbles.iter().map(|s| s.track.as_str()).collect::<Vec<_>>(), vec!["Done"]);
    }

    #[test]
    fn empty_mbids_and_an_empty_album_become_none() {
        let bare = json!({ "artist": { "mbid": "", "#text": "Artist" }, "name": "Bare", "mbid": "", "album": { "mbid": "", "#text": "" }, "date": { "uts": "1000000", "#text": "" } });
        let parsed = parse_page(&page(json!([bare]), 1)).unwrap();

        let only = &parsed.scrobbles[0];
        assert_eq!((only.album.as_deref(), only.recording_mbid.as_deref(), only.artist_mbid.as_deref(), only.release_mbid.as_deref()), (None, None, None, None));
    }

    #[test]
    fn an_empty_page_has_no_scrobbles_and_no_pages() {
        let parsed = parse_page(&json!({ "recenttracks": { "track": [], "@attr": { "totalPages": "0", "page": "1" } } }).to_string()).unwrap();

        assert_eq!((parsed.scrobbles.len(), parsed.total_pages), (0, 0));
    }

    #[test]
    fn api_error_reads_the_error_object() {
        assert_eq!(api_error(&json!({ "error": 29, "message": "Rate Limit Exceeded" }).to_string()), Some((29, "Rate Limit Exceeded".to_string())));
        assert_eq!(api_error(&page(json!([]), 0)), None);
    }

    #[test]
    fn a_scrobble_with_a_twin_in_listens_is_not_added() {
        let mut existing = Existing::default();
        existing.add("Song", 10_000);

        let plan = plan_import(&[scrobble("Song", 10_000 + 359), scrobble("Song", 10_000 + 361 + 360)], &mut existing);

        assert_eq!(plan.counts.already_listened, 1);
        assert_eq!(plan.listens.len(), 1);
        assert_eq!(plan.listens[0].listened_at, 10_000 + 361 + 360);
    }

    #[test]
    fn the_same_scrobble_twice_in_one_import_is_added_once() {
        let mut existing = Existing::default();

        let plan = plan_import(&[scrobble("Song", 5_000), scrobble("Song", 5_000)], &mut existing);

        assert_eq!(plan.listens.len(), 1);
    }

    #[test]
    fn mbids_and_album_are_kept_on_the_planned_listen() {
        let full = Scrobble { album: Some("Album".into()), recording_mbid: Some("rec".into()), artist_mbid: Some("art".into()), release_mbid: Some("rel".into()), ..scrobble("Song", 5_000) };

        let plan = plan_import(&[full], &mut Existing::default());

        let listen = &plan.listens[0];
        assert_eq!((listen.recording_mbid.as_deref(), listen.artist_mbid.as_deref(), listen.release_mbid.as_deref(), listen.release_name.as_deref(), listen.duration_ms), (Some("rec"), Some("art"), Some("rel"), Some("Album"), None));
    }

    #[test]
    fn a_rerun_over_the_same_scrobbles_adds_nothing() {
        let scrobbles = [scrobble("Song", 5_000), scrobble("Other", 9_000)];
        let mut existing = Existing::default();
        let first = plan_import(&scrobbles, &mut existing);
        for listen in &first.listens {
            existing.add(&listen.track_name, listen.listened_at);
        }

        let second = plan_import(&scrobbles, &mut existing);

        assert_eq!((first.listens.len(), second.listens.len()), (2, 0));
    }

    fn stub_pages(total: u32) -> impl FnMut(u32) -> Result<String> {
        move |number| Ok(page(json!([track(&format!("Song {number}"), "Artist", 1_000_000 + i64::from(number))]), total))
    }

    #[test]
    fn fetch_lands_every_page_the_first_page_announces() {
        let mut landed = Vec::new();

        let count = fetch_pages(1, stub_pages(3), |_| {}, |number, _| {
            landed.push(number);
            Ok(())
        })
        .unwrap();

        assert_eq!((count, landed), (3, vec![1, 2, 3]));
    }

    #[test]
    fn a_rate_limit_is_waited_out_and_retried_not_landed() {
        let mut calls = 0;
        let mut slept = Vec::new();
        let mut landed = Vec::new();

        fetch_pages(
            1,
            |_| {
                calls += 1;
                if calls == 1 {
                    Ok(json!({ "error": 29, "message": "Rate Limit Exceeded" }).to_string())
                } else {
                    Ok(page(json!([track("S", "A", 1_000_000)]), 1))
                }
            },
            |wait| slept.push(wait),
            |number, text| {
                assert!(!text.contains("Rate Limit"));
                landed.push(number);
                Ok(())
            },
        )
        .unwrap();

        assert_eq!((calls, slept.len(), landed), (2, 1, vec![1]));
    }

    #[test]
    fn fetch_resumes_after_the_pages_already_landed() {
        let mut asked = Vec::new();
        let mut landed = Vec::new();

        let count = fetch_pages(
            4,
            |number| {
                asked.push(number);
                Ok(page(json!([track("S", "A", 1_000_000)]), 6))
            },
            |_| {},
            |number, _| {
                landed.push(number);
                Ok(())
            },
        )
        .unwrap();

        assert_eq!((count, asked, landed), (3, vec![4, 5, 6], vec![4, 5, 6]));
    }

    #[test]
    fn next_page_is_one_after_the_highest_landed_page() {
        let directory = std::env::temp_dir().join(format!("lastfm-next-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        assert_eq!(next_page(&directory).unwrap(), 1);
        std::fs::write(directory.join("page-00001.json"), "{}").unwrap();
        std::fs::write(directory.join("page-00248.json"), "{}").unwrap();
        std::fs::write(directory.join("notes.txt"), "x").unwrap();

        assert_eq!(next_page(&directory).unwrap(), 249);
    }

    #[test]
    fn any_other_api_error_stops_the_fetch() {
        let result = fetch_pages(1, |_| Ok(json!({ "error": 10, "message": "Invalid API key" }).to_string()), |_| {}, |_, _| Ok(()));

        assert!(result.unwrap_err().to_string().contains("Invalid API key"));
    }

    #[test]
    fn import_reads_a_landed_folder_writes_the_listens_and_a_second_run_adds_nothing() {
        let directory = std::env::temp_dir().join(format!("lastfm-import-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join("page-00001.json"), page(json!([track("Song", "Artist", 1_262_347_200), track("Older", "Artist", 1_262_340_000)]), 2)).unwrap();
        std::fs::write(directory.join("page-00002.json"), page(json!([track("Oldest", "Artist", 1_262_330_000)]), 2)).unwrap();
        std::fs::write(directory.join("notes.txt"), "not a page").unwrap();
        let db = SqliteClient::open(Path::new(":memory:")).unwrap();
        crate::schema::apply(&db).unwrap();

        import(&db, &directory, false).unwrap();
        import(&db, &directory, false).unwrap();

        let rows = db.query("SELECT track_name, recording_mbid FROM listens ORDER BY listened_at", &[]).unwrap();
        let names: Vec<&str> = rows.iter().filter_map(|row| row["track_name"].as_str()).collect();
        assert_eq!(names, vec!["Oldest", "Older", "Song"]);
        assert_eq!(rows[0]["recording_mbid"], "t-mbid");
    }

    #[test]
    fn a_dry_run_writes_nothing() {
        let directory = std::env::temp_dir().join(format!("lastfm-dry-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join("page-00001.json"), page(json!([track("Song", "Artist", 1_262_347_200)]), 1)).unwrap();
        let db = SqliteClient::open(Path::new(":memory:")).unwrap();
        crate::schema::apply(&db).unwrap();

        import(&db, &directory, true).unwrap();

        assert!(db.query("SELECT 1 FROM listens", &[]).unwrap().is_empty());
    }

    #[test]
    fn track_info_gives_the_ids_and_the_names_last_fm_has_for_the_track() {
        let json = r#"{"track":{"name":"Do It","mbid":"rec-1","artist":{"name":"Chloe x Halle","mbid":"art-1"},"album":{"title":"The Kids Are Alright","mbid":"rel-1"}}}"#;
        let found = parse_track_info(json).unwrap().unwrap();
        assert_eq!(found.recording_mbid, "rec-1");
        assert_eq!(found.artist_mbid.as_deref(), Some("art-1"));
        assert_eq!(found.release_mbid.as_deref(), Some("rel-1"));
        assert_eq!((found.title.as_str(), found.artist_credit.as_str()), ("Do It", "Chloe x Halle"));
        assert_eq!(found.credited, vec!["Chloe x Halle".to_string()]);
    }

    #[test]
    fn a_track_without_a_recording_id_is_not_a_match() {
        let json = r#"{"track":{"name":"Do It","mbid":"","artist":{"name":"Chloe x Halle","mbid":"art-1"}}}"#;
        assert!(parse_track_info(json).unwrap().is_none());
        assert!(parse_track_info(r#"{"track":{"name":"Do It","artist":{"name":"X"}}}"#).unwrap().is_none());
    }

    #[test]
    fn a_track_last_fm_does_not_know_is_not_an_error_but_any_other_error_is() {
        assert!(parse_track_info(r#"{"error":6,"message":"Track not found"}"#).unwrap().is_none());
        assert!(parse_track_info(r#"{"error":10,"message":"Invalid API key"}"#).is_err());
    }

    #[test]
    fn an_answer_that_is_not_json_or_asks_to_wait_is_transient_and_a_real_error_or_an_answer_is_not() {
        assert!(is_transient("<html>502 Bad Gateway</html>"));
        assert!(is_transient(""));
        assert!(is_transient(r#"{"error":29,"message":"Rate limit exceeded"}"#));
        assert!(!is_transient(r#"{"error":10,"message":"Invalid API key"}"#));
        assert!(!is_transient(r#"{"track":{"name":"x"}}"#));
    }
}
