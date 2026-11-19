//! `import-apple <Apple_Media_Services>`: what Apple TV and Apple TV+ played, from Apple's data export, into
//! `apple_tv_play`. Apart from `tv_watch` (the hand-kept log, matched to TMDB): this is what the app says, unmatched.
//! A span the export reports twice (a seek writes a second stop) is one row, keyed on its start and title.

use std::collections::BTreeMap;
use std::path::Path;

use anyhow::{Context, Result};
use serde_json::{json, Value};
use shared_data::apple_export::unix_seconds;
use shared_data::apple_stores_export::{parse_feature_title, read_video_stops, VideoStop};
use shared_data::batch::insert_statements;
use shared_data::job::Job;
use shared_data::sqlite_client::SqliteClient;

const COLUMNS: &[&str] = &[
    "started_at", "feature_title", "ended_at", "show", "season", "episode", "episode_title", "content_ms", "play_ms",
    "max_position_ms", "provider",
];

/// One span per (start, title); of a repeated one the longest watched is kept.
pub fn spans(stops: Vec<VideoStop>) -> Result<Vec<(i64, VideoStop)>> {
    let mut spans: BTreeMap<(i64, String), VideoStop> = BTreeMap::new();
    for stop in stops {
        let (Some(start), Some(title)) = (stop.started_at.as_deref(), stop.feature_title.clone()) else { continue };
        let started_at = unix_seconds(start)?;
        let kept = spans.entry((started_at, title)).or_insert_with(|| stop.clone());
        if stop.play_ms > kept.play_ms {
            *kept = stop;
        }
    }
    Ok(spans.into_iter().map(|((started_at, _), stop)| (started_at, stop)).collect())
}

fn values(started_at: i64, stop: &VideoStop) -> Vec<Value> {
    let title = stop.feature_title.as_deref().unwrap_or_default();
    let parsed = parse_feature_title(title);
    vec![
        json!(started_at),
        json!(title),
        json!(stop.ended_at.as_deref().and_then(|end| unix_seconds(end).ok())),
        json!(parsed.show),
        json!(parsed.season),
        json!(parsed.episode),
        json!(parsed.title),
        json!(stop.content_ms),
        json!(stop.play_ms),
        json!(stop.max_position_ms),
        json!(stop.provider),
    ]
}

pub fn job() -> Job<SqliteClient> {
    Job::import_folder("import-apple", "keep what Apple TV and Apple TV+ played, from Apple's data export", import)
}

pub fn import(db: &SqliteClient, root: &Path, dry_run: bool) -> Result<()> {
    let spans = spans(read_video_stops(root).context("reading the video play activity")?)?;
    println!("{} spans watched", spans.len());
    if dry_run {
        println!("dry run: nothing written");
        return Ok(());
    }
    let statements = insert_statements("INSERT OR REPLACE INTO", "apple_tv_play", COLUMNS, spans.iter().map(|(at, stop)| values(*at, stop)));
    db.execute_batch(&statements).context("writing the Apple TV plays")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stop(start: &str, play_ms: i64) -> VideoStop {
        VideoStop {
            action_type: "stop".into(),
            started_at: Some(start.into()),
            ended_at: None,
            feature_title: Some("Severance S2E6 Attila VSN A000590200601".into()),
            sub_type: None,
            content_ms: Some(3_339_794),
            play_ms: Some(play_ms),
            max_position_ms: None,
            provider: Some("Apple TV+".into()),
        }
    }

    #[test]
    fn a_span_reported_twice_is_one_row_with_the_longest_time_watched() {
        let kept = spans(vec![stop("2025-02-21T18:11:52.751Z", 100), stop("2025-02-21T18:11:52.751Z", 3_000)]).unwrap();
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].1.play_ms, Some(3_000));
    }

    #[test]
    fn two_spans_of_one_episode_at_different_times_stay_two() {
        let kept = spans(vec![stop("2025-02-21T18:11:52.751Z", 100), stop("2025-02-22T18:11:52.751Z", 100)]).unwrap();
        assert_eq!(kept.len(), 2);
    }

    #[test]
    fn the_row_carries_the_show_season_and_episode_of_the_title() {
        let row = values(1, &stop("2025-02-21T18:11:52.751Z", 1));
        assert_eq!((row[3].clone(), row[4].clone(), row[5].clone(), row[6].clone()), (json!("Severance"), json!(2), json!(6), json!("Attila")));
    }
}
