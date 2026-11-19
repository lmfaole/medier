//! Spotify's "Extended streaming history" export (`Streaming_History_Audio_*.json`),
//! read once for both importers: music takes the track rows, podcasts the
//! episode rows. Nothing here decides what to keep.

use std::path::Path;

use anyhow::{Context, Result};
use chrono::DateTime;
use serde::Deserialize;

/// One play. `ts` is when it **ended**; see [`StreamingRow::started_at`].
#[derive(Debug, Clone, Deserialize)]
pub struct StreamingRow {
    pub ts: String,
    pub ms_played: i64,
    #[serde(default)]
    pub platform: Option<String>,
    #[serde(default)]
    pub reason_end: Option<String>,
    #[serde(default)]
    pub master_metadata_track_name: Option<String>,
    #[serde(default)]
    pub master_metadata_album_artist_name: Option<String>,
    #[serde(default)]
    pub master_metadata_album_album_name: Option<String>,
    #[serde(default)]
    pub episode_name: Option<String>,
    #[serde(default)]
    pub episode_show_name: Option<String>,
    #[serde(default)]
    pub spotify_episode_uri: Option<String>,
}

impl StreamingRow {
    /// Unix seconds when the play began: the export stamps the end, and
    /// ListenBrainz (and the `listens` table) the start.
    pub fn started_at(&self) -> Result<i64> {
        let ended = DateTime::parse_from_rfc3339(&self.ts)
            .with_context(|| format!("{} is not a timestamp", self.ts))?
            .timestamp();
        Ok(ended - self.ms_played / 1000)
    }
}

/// Every audio row of the export folder, in file-name order.
pub fn read_audio_rows(directory: &Path) -> Result<Vec<StreamingRow>> {
    let mut files: Vec<_> = std::fs::read_dir(directory)
        .with_context(|| format!("could not read {}", directory.display()))?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| {
            let is_json = path.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("json"));
            let is_audio = path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("Streaming_History_Audio_"));
            is_json && is_audio
        })
        .collect();
    files.sort();

    let mut rows = Vec::new();
    for file in &files {
        let text = std::fs::read_to_string(file).with_context(|| format!("could not read {}", file.display()))?;
        let mut batch: Vec<StreamingRow> =
            serde_json::from_str(&text).with_context(|| format!("{} is not an export file", file.display()))?;
        rows.append(&mut batch);
    }
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(ts: &str, ms_played: i64) -> StreamingRow {
        StreamingRow {
            ts: ts.to_string(),
            ms_played,
            platform: None,
            reason_end: None,
            master_metadata_track_name: None,
            master_metadata_album_artist_name: None,
            master_metadata_album_album_name: None,
            episode_name: None,
            episode_show_name: None,
            spotify_episode_uri: None,
        }
    }

    #[test]
    fn a_play_started_when_it_ended_minus_the_time_played() {
        let play = row("2024-05-29T13:36:54Z", 133_805);
        assert_eq!(play.started_at().unwrap_or_default(), 1_716_989_814 - 133);
    }

    #[test]
    fn a_bad_timestamp_is_an_error() {
        assert!(row("yesterday", 1).started_at().is_err());
    }
}
