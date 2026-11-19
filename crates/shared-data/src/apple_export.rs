//! The music part of Apple's "Apple Media Services" data export, read into plain
//! rows. Nothing here decides what to keep. The play log also holds the device's
//! IP address and position; those columns are not read, so they cannot reach a
//! table.

use std::path::Path;

use anyhow::{Context, Result};
use chrono::DateTime;
use serde::Deserialize;

/// One finished play (`PLAY_END`) of `Apple Music Play Activity.csv`. The start and
/// end are the device's own clock in UTC, so no estimate is needed.
#[derive(Debug, Clone, Deserialize)]
pub struct PlayEnd {
    #[serde(rename = "Event ID")]
    pub event_id: String,
    #[serde(rename = "Event Type")]
    pub event_type: String,
    #[serde(rename = "Event Start Timestamp")]
    pub started_at: Option<String>,
    #[serde(rename = "Event End Timestamp")]
    pub ended_at: Option<String>,
    #[serde(rename = "Song Name")]
    pub song_name: Option<String>,
    #[serde(rename = "Album Name")]
    pub album_name: Option<String>,
    #[serde(rename = "Play Duration Milliseconds")]
    pub play_ms: Option<i64>,
    #[serde(rename = "Media Duration In Milliseconds")]
    pub media_ms: Option<i64>,
    #[serde(rename = "End Reason Type")]
    pub end_reason: Option<String>,
    #[serde(rename = "Start Position In Milliseconds")]
    pub start_position_ms: Option<i64>,
    #[serde(rename = "Media Type")]
    pub media_type: Option<String>,
    #[serde(rename = "Container Type")]
    pub container_type: Option<String>,
    #[serde(rename = "Container Name")]
    pub container_name: Option<String>,
    #[serde(rename = "Feature Name")]
    pub feature: Option<String>,
    #[serde(rename = "Device Type")]
    pub device: Option<String>,
    #[serde(rename = "UTC Offset In Seconds")]
    pub utc_offset: Option<i64>,
    #[serde(rename = "Shuffle Play")]
    pub shuffle: Option<String>,
}

/// Unix seconds of an RFC 3339 timestamp, as Apple writes them.
pub fn unix_seconds(text: &str) -> Result<i64> {
    Ok(DateTime::parse_from_rfc3339(text).with_context(|| format!("{text} is not a timestamp"))?.timestamp())
}

/// Every finished play that names a song; the start pings and lyric events carry
/// nothing the finished play does not.
pub fn read_play_ends(file: &Path) -> Result<Vec<PlayEnd>> {
    let mut reader = csv::Reader::from_path(file).with_context(|| format!("could not read {}", file.display()))?;
    let mut plays = Vec::new();
    for row in reader.deserialize::<PlayEnd>() {
        let play = row.with_context(|| format!("{} is not the play activity file", file.display()))?;
        if play.event_type == "PLAY_END" && play.song_name.is_some() {
            plays.push(play);
        }
    }
    Ok(plays)
}

/// One song or music video of the library.
#[derive(Debug, Clone, Deserialize)]
pub struct LibraryTrack {
    #[serde(rename = "Track Identifier")]
    pub track_id: i64,
    #[serde(rename = "Content Type", default)]
    pub content_type: Option<String>,
    #[serde(rename = "Title", default)]
    pub title: Option<String>,
    #[serde(rename = "Artist", default)]
    pub artist: Option<String>,
    #[serde(rename = "Album", default)]
    pub album: Option<String>,
    #[serde(rename = "Album Artist", default)]
    pub album_artist: Option<String>,
    #[serde(rename = "Genre", default)]
    pub genre: Option<String>,
    #[serde(rename = "Track Year", default)]
    pub year: Option<i64>,
    #[serde(rename = "Track Number On Album", default)]
    pub track_number: Option<i64>,
    #[serde(rename = "Disc Number Of Album", default)]
    pub disc_number: Option<i64>,
    #[serde(rename = "Track Duration", default)]
    pub duration_ms: Option<i64>,
    #[serde(rename = "Release Date", default)]
    pub release_date: Option<String>,
    #[serde(rename = "Date Added To Library", default)]
    pub added_at: Option<String>,
    #[serde(rename = "Track Play Count", default)]
    pub play_count: Option<i64>,
    #[serde(rename = "Skip Count", default)]
    pub skip_count: Option<i64>,
    #[serde(rename = "Apple Music Track Identifier", default)]
    pub catalog_id: Option<i64>,
    #[serde(rename = "Favorite Status - Track", default)]
    pub favorite: Option<bool>,
}

pub fn read_library_tracks(file: &Path) -> Result<Vec<LibraryTrack>> {
    let text = std::fs::read_to_string(file).with_context(|| format!("could not read {}", file.display()))?;
    serde_json::from_str(&text).with_context(|| format!("{} is not the library tracks file", file.display()))
}

/// A playlist, folder or smart list of the library, with its items in order.
#[derive(Debug, Clone, Deserialize)]
pub struct Playlist {
    #[serde(rename = "Container Identifier")]
    pub playlist_id: i64,
    #[serde(rename = "Container Type", default)]
    pub kind: Option<String>,
    #[serde(rename = "Title", default)]
    pub title: Option<String>,
    #[serde(rename = "Description", default)]
    pub description: Option<String>,
    #[serde(rename = "Parent Folder Identifier", default)]
    pub parent_id: Option<i64>,
    #[serde(rename = "Added Date", default)]
    pub added_at: Option<String>,
    #[serde(rename = "Playlist Item Identifiers", default)]
    pub items: Vec<i64>,
}

pub fn read_playlists(file: &Path) -> Result<Vec<Playlist>> {
    let text = std::fs::read_to_string(file).with_context(|| format!("could not read {}", file.display()))?;
    serde_json::from_str(&text).with_context(|| format!("{} is not the playlists file", file.display()))
}

/// A like or dislike of a song, album, artist or playlist.
#[derive(Debug, Clone, Deserialize)]
pub struct Favorite {
    #[serde(rename = "Favorite Type")]
    pub kind: String,
    #[serde(rename = "Item Reference")]
    pub item_ref: String,
    #[serde(rename = "Item Description", default)]
    pub description: Option<String>,
    #[serde(rename = "Last Modified", default)]
    pub modified_at: Option<String>,
    #[serde(rename = "Preference")]
    pub preference: String,
}

pub fn read_favorites(file: &Path) -> Result<Vec<Favorite>> {
    let mut reader = csv::Reader::from_path(file).with_context(|| format!("could not read {}", file.display()))?;
    reader
        .deserialize::<Favorite>()
        .collect::<std::result::Result<Vec<_>, _>>()
        .with_context(|| format!("{} is not the favorites file", file.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(name: &str, text: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("apple-export-{}-{name}", std::process::id()));
        std::fs::write(&path, text).unwrap();
        path
    }

    #[test]
    fn only_finished_plays_with_a_song_are_read_and_the_position_columns_are_ignored() {
        let path = write(
            "plays.csv",
            "Event ID,Event Type,Song Name,Client IP Address,IP Latitude,Play Duration Milliseconds\n\
             1,PLAY_END,Song,10.0.0.1,59.9,200000\n\
             2,PLAY_START,Song,10.0.0.1,59.9,\n\
             3,PLAY_END,,10.0.0.1,59.9,5\n",
        );
        let plays = read_play_ends(&path).unwrap();
        assert_eq!(plays.len(), 1);
        assert_eq!((plays[0].event_id.as_str(), plays[0].play_ms), ("1", Some(200_000)));
    }

    #[test]
    fn a_timestamp_with_milliseconds_is_whole_seconds() {
        assert_eq!(unix_seconds("2025-02-10T06:15:26.061Z").unwrap(), 1_739_168_126);
        assert!(unix_seconds("yesterday").is_err());
    }

    #[test]
    fn a_playlist_without_items_is_a_folder_with_none() {
        let path = write("playlists.json", r#"[{"Container Identifier": 7, "Title": "Mix", "Playlist Item Identifiers": [3, 1]}, {"Container Identifier": 8}]"#);
        let lists = read_playlists(&path).unwrap();
        assert_eq!((lists[0].items.clone(), lists[1].items.len()), (vec![3, 1], 0));
    }
}
