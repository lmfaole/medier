//! The video and podcast files of Apple's "Apple Media Services" export (folder
//! `Apple_Media_Services`), read into plain rows beside `apple_export` (the music
//! files). The device's IP address and position that the play files hold are not
//! read, and nothing here decides what to keep.

use std::path::Path;

use anyhow::{Context, Result};
use serde::Deserialize;

const VIDEO_FILE: &str = "Stores Activity/Other Activity/Video Play Activity.csv";
const PODCAST_DIRECTORY: &str = "Stores Activity/Apple TV and Podcast Information";

fn read_csv<T: for<'de> Deserialize<'de>>(file: &Path) -> Result<Vec<T>> {
    let mut reader = csv::Reader::from_path(file).with_context(|| format!("could not read {}", file.display()))?;
    reader
        .deserialize::<T>()
        .collect::<std::result::Result<Vec<_>, _>>()
        .with_context(|| format!("{} is not the file it should be", file.display()))
}

/// One `stop` of Apple TV playback: the span watched, which the start event only opens.
#[derive(Debug, Clone, Deserialize)]
pub struct VideoStop {
    #[serde(rename = "Action Type")]
    pub action_type: String,
    #[serde(rename = "UTC Start Time")]
    pub started_at: Option<String>,
    #[serde(rename = "UTC End Time")]
    pub ended_at: Option<String>,
    #[serde(rename = "Content Master Feature Title")]
    pub feature_title: Option<String>,
    #[serde(rename = "Content Sub-Type")]
    pub sub_type: Option<String>,
    #[serde(rename = "Content Length MS")]
    pub content_ms: Option<i64>,
    #[serde(rename = "Play Duration")]
    pub play_ms: Option<i64>,
    #[serde(rename = "Max Feature Play Position")]
    pub max_position_ms: Option<i64>,
    #[serde(rename = "Provider Brand Name")]
    pub provider: Option<String>,
}

/// The stops of real content: not the start events, not trailers and promos, and only
/// those that say when and what.
pub fn read_video_stops(root: &Path) -> Result<Vec<VideoStop>> {
    Ok(read_csv::<VideoStop>(&root.join(VIDEO_FILE))?
        .into_iter()
        .filter(|stop| {
            stop.action_type == "stop" && stop.sub_type.is_none() && stop.started_at.is_some() && stop.feature_title.is_some()
        })
        .collect())
}

/// «Severance S2E6 Attila VSN A000590200601» as the show, season, episode and episode title.
/// Anything not shaped like that (a film) has only the title, with the code removed.
#[derive(Debug, PartialEq, Eq)]
pub struct FeatureTitle {
    pub show: String,
    pub season: Option<i64>,
    pub episode: Option<i64>,
    pub title: Option<String>,
}

fn season_and_episode(word: &str) -> Option<(i64, i64)> {
    let (season, episode) = word.strip_prefix('S')?.split_once('E')?;
    Some((season.parse().ok()?, episode.parse().ok()?))
}

#[must_use]
pub fn parse_feature_title(text: &str) -> FeatureTitle {
    let words: Vec<&str> = text.split_whitespace().take_while(|word| *word != "VSN").collect();
    match words.iter().position(|word| season_and_episode(word).is_some()) {
        Some(at) if at > 0 => {
            let (season, episode) = season_and_episode(words[at]).unzip();
            let title = words[at + 1..].join(" ");
            FeatureTitle { show: words[..at].join(" "), season, episode, title: (!title.is_empty()).then_some(title) }
        }
        _ => FeatureTitle { show: words.join(" "), season: None, episode: None, title: None },
    }
}

/// A podcast the owner follows (`Your Podcasts.csv`) or has played without following
/// (`Your Other (Non-Followed) Podcasts.csv`, which has no title).
#[derive(Debug, Clone, Deserialize)]
pub struct PodcastFeed {
    #[serde(rename = "Feed URL")]
    pub feed_url: String,
    #[serde(rename = "Title", default)]
    pub title: Option<String>,
    #[serde(rename = "Subscribed?", default)]
    pub subscribed: Option<String>,
    #[serde(rename = "Added on", default)]
    pub added_at: Option<String>,
    #[serde(rename = "Last touched on", default)]
    pub touched_at: Option<String>,
    #[serde(rename = "Store collection ID", default)]
    pub store_id: Option<i64>,
    #[serde(rename = "Last date played", default)]
    pub played_at: Option<String>,
}

pub fn read_podcast_feeds(root: &Path) -> Result<Vec<PodcastFeed>> {
    let directory = root.join(PODCAST_DIRECTORY);
    let mut feeds = read_csv::<PodcastFeed>(&directory.join("Your Podcasts.csv"))?;
    feeds.extend(read_csv::<PodcastFeed>(&directory.join("Your Other (Non-Followed) Podcasts.csv"))?);
    Ok(feeds)
}

/// What the Podcasts app remembers of one episode, by the feed and the episode's GUID.
#[derive(Debug, Clone, Deserialize)]
pub struct PodcastState {
    #[serde(rename = "Feed URL")]
    pub feed_url: String,
    #[serde(rename = "Episode ID")]
    pub episode_id: String,
    #[serde(rename = "Last played on", default)]
    pub played_at: Option<String>,
    #[serde(rename = "Playback position", default)]
    pub position: Option<f64>,
    #[serde(rename = "Play count", default)]
    pub play_count: Option<i64>,
    #[serde(rename = "Has been played?", default)]
    pub played: Option<String>,
}

pub fn read_podcast_states(root: &Path) -> Result<Vec<PodcastState>> {
    read_csv(&root.join(PODCAST_DIRECTORY).join("Podcasts Playstate.csv"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_episode_title_is_split_into_show_season_episode_and_name() {
        let parsed = parse_feature_title("Severance S2E6 Attila VSN A000590200601");
        assert_eq!(
            parsed,
            FeatureTitle { show: "Severance".into(), season: Some(2), episode: Some(6), title: Some("Attila".into()) }
        );
        assert_eq!(parse_feature_title("The Secret Lives of Animals S1E8 Finding a Partner VSN A006").show, "The Secret Lives of Animals");
    }

    #[test]
    fn a_title_with_no_episode_marker_is_a_film_with_only_a_name() {
        let parsed = parse_feature_title("F1 The Movie VSN A0079601001");
        assert_eq!((parsed.show.as_str(), parsed.season, parsed.title), ("F1 The Movie", None, None));
    }

    #[test]
    fn a_word_that_only_looks_like_a_marker_does_not_split_a_title() {
        assert_eq!(parse_feature_title("S1E2 VSN X").season, None);
        assert_eq!(parse_feature_title("Show S1Exit VSN X").season, None);
    }
}
