//! The podcast listening log `gpoddersync` (`AntennaPod`, through Nextcloud) recorded. Nextcloud's own repository
//! exports it (`export/gpodder-episode-actions.jsonl`, one JSON object per action, written by its
//! `gpodder-export.ts` after each database dump); this reads that file and knows nothing else of Nextcloud.

use anyhow::{Context, Result};
use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Deserialize)]
pub struct EpisodeActionRaw {
    pub id: i64,
    pub podcast: String,
    pub episode: String,
    pub action: String,
    pub position: i64,
    pub started: i64,
    pub total: i64,
    pub timestamp: Option<String>,
    pub timestamp_epoch: i64,
    pub guid: Option<String>,
}

/// The exported log: in the Nextcloud repository (`NEXTCLOUD_DIR`, else `~/Dokumenter/nextcloud`).
pub fn export_path() -> PathBuf {
    let service = std::env::var_os("NEXTCLOUD_DIR")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Dokumenter/nextcloud")))
        .unwrap_or_default();
    service.join("export/gpodder-episode-actions.jsonl")
}

fn parse(text: &str) -> Result<Vec<EpisodeActionRaw>> {
    text.lines()
        .filter(|line| !line.trim().is_empty())
        .enumerate()
        .map(|(index, line)| serde_json::from_str(line).with_context(|| format!("line {} of the exported actions", index + 1)))
        .collect()
}

pub fn read_actions(file: &Path) -> Result<Vec<EpisodeActionRaw>> {
    let text = std::fs::read_to_string(file).with_context(|| format!("reading {}: run `npm run gpodder:export` in the Nextcloud repository", file.display()))?;
    parse(&text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_action_keeps_its_nulls_and_a_blank_line_is_skipped() {
        let text = concat!(
            r#"{"id": 1, "podcast": "https://x/feed.xml", "episode": "https://x/1.mp3", "action": "PLAY", "position": 711, "started": 0, "total": 1437, "timestamp": null, "guid": "l_abc", "timestamp_epoch": 1792313328}"#,
            "\n\n",
            r#"{"id": 2, "podcast": "p", "episode": "e", "action": "FINISH", "position": 5, "started": 0, "total": 5, "timestamp": "2026-10-22 19:11:11", "guid": null, "timestamp_epoch": 0}"#,
            "\n"
        );
        let actions = parse(text).expect("parse");
        assert_eq!(actions.len(), 2);
        assert_eq!((actions[0].timestamp.as_deref(), actions[0].guid.as_deref(), actions[0].timestamp_epoch), (None, Some("l_abc"), 1_792_313_328));
        assert_eq!((actions[1].timestamp.as_deref(), actions[1].guid.as_deref()), (Some("2026-10-22 19:11:11"), None));
    }

    #[test]
    fn a_broken_line_names_its_number() {
        let error = parse("{\"id\": 1}\n").expect_err("incomplete").to_string();
        assert!(error.contains("line 1"), "{error}");
    }
}
