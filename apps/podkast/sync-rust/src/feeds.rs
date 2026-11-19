//! The titles of what the player recorded, from the feeds it listens through. `AntennaPod` may subscribe to a copy of a
//! show's feed (the NRK shows come through two public mirrors) that Apple's directory does not know, so the feed URL in
//! the gpodder log matches no show of `podcasts.db`. The feed is fetched, landed unchanged under
//! `.data/raw/podcast-feeds/<date>/`, and gives the show's name and each episode's title by the media URL the player had.
//!
//! The import runs every three hours and the feeds are megabytes, so a feed is asked for with the `ETag` and
//! `Last-Modified` its last landed copy came with (kept beside it as `.headers.json`): an unchanged feed answers 304 and
//! is read from that copy, and a copy is landed only when the feed differs from the last one.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use anyhow::Result;
use reqwest::header::{ETAG, IF_MODIFIED_SINCE, IF_NONE_MATCH, LAST_MODIFIED};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use shared_data::text::{normalize, slug};

/// One feed read: the show's title and the title of each episode, by its media URL and by its guid.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Feed {
    pub title: String,
    pub by_url: HashMap<String, String>,
    pub by_guid: HashMap<String, String>,
}

/// What a feed says about one recorded episode.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Found {
    /// The show as `podcasts.db` names it, or else as the feed does.
    pub show: String,
    pub episode_title: Option<String>,
}

fn child_text(node: roxmltree::Node, name: &str) -> Option<String> {
    node.children().find(|child| child.is_element() && child.tag_name().name() == name).and_then(|child| child.text()).map(|text| text.trim().to_string()).filter(|text| !text.is_empty())
}

/// A feed's XML as its show title and episode titles; `None` when it is no feed.
#[must_use]
pub fn parse(xml: &str) -> Option<Feed> {
    let document = roxmltree::Document::parse(xml).ok()?;
    let channel = document.descendants().find(|node| node.is_element() && node.tag_name().name() == "channel")?;
    let mut feed = Feed { title: child_text(channel, "title")?, ..Feed::default() };
    for item in channel.children().filter(|node| node.is_element() && node.tag_name().name() == "item") {
        let Some(title) = child_text(item, "title") else { continue };
        if let Some(url) = item.children().find(|node| node.is_element() && node.tag_name().name() == "enclosure").and_then(|node| node.attribute("url")) {
            feed.by_url.insert(url.trim().to_string(), title.clone());
        }
        if let Some(guid) = child_text(item, "guid") {
            feed.by_guid.insert(guid, title);
        }
    }
    Some(feed)
}

/// The feeds of one run, fetched the first time a recorded episode names them.
pub struct Feeds {
    http: reqwest::blocking::Client,
    /// `.data/raw/podcast-feeds`, with one folder per day.
    root: PathBuf,
    directory: PathBuf,
    shows: Vec<String>,
    cache: HashMap<String, Option<Feed>>,
}

impl Feeds {
    /// `shows` are the names `podcasts.db` knows (`podcast_shows`), so a feed's title can be put under the right one.
    pub fn open(shows: Vec<String>) -> Result<Self> {
        let http = shared_data::http::client("podkast-sync/0.1 (+https://sky.lmfaole.party/apps/medier/podkast)")?;
        let raw_root = std::env::var_os("DATA_RAW").map_or_else(|| PathBuf::from("../../.data/raw"), PathBuf::from);
        let root = raw_root.join("podcast-feeds");
        let directory = root.join(chrono::Utc::now().date_naive().to_string());
        Ok(Self { http, root, directory, shows, cache: HashMap::new() })
    }

    fn fetch(&self, url: &str) -> Option<Feed> {
        let name = format!("gpodder-{}", slug(url));
        let landed = newest_landed(&self.root, &name);
        let mut request = self.http.get(url);
        if let Some((_, validators)) = &landed {
            if let Some(etag) = &validators.etag {
                request = request.header(IF_NONE_MATCH, etag);
            }
            if let Some(modified) = &validators.last_modified {
                request = request.header(IF_MODIFIED_SINCE, modified);
            }
        }
        let response = match request.send().and_then(reqwest::blocking::Response::error_for_status) {
            Ok(response) => response,
            Err(error) => {
                eprintln!("podkast-sync: the feed {url} could not be fetched: {error}");
                return None;
            }
        };
        if response.status() == StatusCode::NOT_MODIFIED {
            return landed.and_then(|(body, _)| std::fs::read_to_string(body).ok()).and_then(|body| parse(&body));
        }
        let validators = Validators::of(response.headers());
        let body = match response.text() {
            Ok(body) => body,
            Err(error) => {
                eprintln!("podkast-sync: the feed {url} could not be read: {error}");
                return None;
            }
        };
        let feed = parse(&body)?;
        let previous = landed.as_ref().filter(|(path, _)| std::fs::read_to_string(path).is_ok_and(|previous| previous == body));
        let written = match previous {
            // The same feed as last landed: only what to ask again with is kept beside that copy.
            Some((path, _)) => std::fs::write(path.with_extension("headers.json"), validators.text()),
            None => self.land(&name, &body, &validators),
        };
        if written.is_err() {
            eprintln!("podkast-sync: the feed {url} could not be landed under {}", self.directory.display());
        }
        Some(feed)
    }

    /// A new copy in today's folder: `<name>.xml`, or `<name>-2.xml` and on when the feed changed again the same day.
    fn land(&self, name: &str, body: &str, validators: &Validators) -> std::io::Result<()> {
        std::fs::create_dir_all(&self.directory)?;
        let next = copies(&self.directory, name).last().map_or(1, |(number, _)| number + 1);
        let file = self.directory.join(copy_name(name, next));
        std::fs::write(&file, body)?;
        std::fs::write(file.with_extension("headers.json"), validators.text())
    }

    /// What the feed at `feed_url` says about the episode the player had at `episode_url` (with `guid`), or `None` for a
    /// URL that is no feed or a feed that cannot be read.
    pub fn about(&mut self, feed_url: &str, episode_url: &str, guid: Option<&str>) -> Option<Found> {
        if !feed_url.starts_with("http") {
            return None;
        }
        if !self.cache.contains_key(feed_url) {
            let feed = self.fetch(feed_url);
            self.cache.insert(feed_url.to_string(), feed);
        }
        let feed = self.cache.get(feed_url)?.as_ref()?;
        let title = feed.by_url.get(episode_url.trim()).or_else(|| guid.and_then(|guid| feed.by_guid.get(guid.strip_prefix("l_").unwrap_or(guid)))).cloned();
        let known = self.shows.iter().find(|show| normalize(show) == normalize(&feed.title));
        Some(Found { show: known.cloned().unwrap_or_else(|| feed.title.clone()), episode_title: title })
    }
}

/// What a feed's server said to ask again with, so an unchanged feed is not sent again.
#[derive(Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
struct Validators {
    etag: Option<String>,
    last_modified: Option<String>,
}

impl Validators {
    fn of(headers: &reqwest::header::HeaderMap) -> Self {
        let text = |name| headers.get(name).and_then(|value: &reqwest::header::HeaderValue| value.to_str().ok()).map(str::to_string);
        Self { etag: text(ETAG), last_modified: text(LAST_MODIFIED) }
    }

    fn text(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }
}

fn copy_name(name: &str, number: u32) -> String {
    if number == 1 { format!("{name}.xml") } else { format!("{name}-{number}.xml") }
}

/// The copies of the feed `name` in one day's folder, by their number, oldest first.
fn copies(day: &Path, name: &str) -> Vec<(u32, PathBuf)> {
    let mut found = Vec::new();
    loop {
        let number = u32::try_from(found.len()).unwrap_or(u32::MAX) + 1;
        let path = day.join(copy_name(name, number));
        if !path.is_file() {
            return found;
        }
        found.push((number, path));
    }
}

/// The newest landed copy of the feed `name` and the validators kept beside it; a copy landed before they were kept has
/// none, so it is asked for whole once more.
fn newest_landed(root: &Path, name: &str) -> Option<(PathBuf, Validators)> {
    let mut days: Vec<PathBuf> = std::fs::read_dir(root).ok()?.filter_map(|entry| entry.ok().map(|entry| entry.path())).collect();
    days.sort();
    let (_, path) = days.iter().rev().find_map(|day| copies(day, name).pop())?;
    let validators = std::fs::read_to_string(path.with_extension("headers.json")).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default();
    Some((path, validators))
}

#[cfg(test)]
mod tests {
    use super::*;

    const FEED: &str = r#"<?xml version="1.0"?><rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>Dagsnytt 18</title>
        <item><title>Opptøyer i Frankrike</title><guid>g-1</guid><enclosure url="https://podkast.nrk.no/a.mp3" type="audio/mpeg"/></item>
        <item><guid>g-2</guid><enclosure url="https://podkast.nrk.no/b.mp3"/></item></channel></rss>"#;

    #[test]
    fn a_feed_gives_its_show_and_the_title_of_each_episode_by_its_media_url_and_guid() {
        let feed = parse(FEED).unwrap_or_default();
        assert_eq!(feed.title, "Dagsnytt 18");
        assert_eq!(feed.by_url.get("https://podkast.nrk.no/a.mp3").map(String::as_str), Some("Opptøyer i Frankrike"));
        assert_eq!(feed.by_guid.get("g-1").map(String::as_str), Some("Opptøyer i Frankrike"));
        assert_eq!(feed.by_url.len(), 1, "an item with no title is left out");
        assert_eq!(parse("not xml"), None);
    }

    #[test]
    fn the_newest_copy_is_the_last_of_the_newest_day_with_the_validators_kept_beside_it() {
        let root = std::env::temp_dir().join(format!("podkast-feeds-{}", std::process::id()));
        for (day, file, text) in [("2026-11-03", "gpodder-f.xml", "old"), ("2026-11-04", "gpodder-f.xml", "morning"), ("2026-11-04", "gpodder-f-2.xml", "evening")] {
            std::fs::create_dir_all(root.join(day)).unwrap_or_default();
            std::fs::write(root.join(day).join(file), text).unwrap_or_default();
        }
        std::fs::write(root.join("2026-11-04").join("gpodder-f-2.headers.json"), r#"{"etag":"\"e2\"","last_modified":null}"#).unwrap_or_default();
        let newest = newest_landed(&root, "gpodder-f");
        let _ = std::fs::remove_dir_all(&root);
        let (path, validators) = newest.unwrap_or_else(|| unreachable!());
        assert!(path.ends_with("2026-11-04/gpodder-f-2.xml"));
        assert_eq!(validators, Validators { etag: Some("\"e2\"".into()), last_modified: None });
        assert_eq!(newest_landed(Path::new("/nonexistent"), "gpodder-f"), None);
    }

    #[test]
    fn the_feed_of_a_mirror_is_put_under_the_show_podcasts_db_knows_by_name() {
        let mut feeds = Feeds::open(vec!["dagsnytt 18".to_string()]).unwrap_or_else(|_| unreachable!());
        feeds.cache.insert("https://mirror.example/f.xml".into(), parse(FEED));
        let found = feeds.about("https://mirror.example/f.xml", "https://podkast.nrk.no/a.mp3", None);
        assert_eq!(found, Some(Found { show: "dagsnytt 18".into(), episode_title: Some("Opptøyer i Frankrike".into()) }));
        assert_eq!(feeds.about("not a url", "x", None), None);
    }
}
