//! `import-apple-podcasts <Apple_Media_Services>`: the feeds followed or played and what the Podcasts app
//! remembers of each episode, from Apple's data export, into `apple_podcast_feed` and `apple_podcast_state`
//! of `.data/podcasts.db`. Both are keyed on what the export keys them by, so a second run changes nothing.

use std::path::Path;

use anyhow::{Context, Result};
use serde_json::{json, Value};
use shared_data::app_db::{open_migrated, path_from_env};
use shared_data::apple_export::unix_seconds;
use shared_data::apple_stores_export::{read_podcast_feeds, read_podcast_states, PodcastFeed, PodcastState};
use shared_data::batch::insert_statements;
use shared_data::job::Job;
use shared_data::sqlite_client::SqliteClient;

use crate::podcasts;

const FEED_COLUMNS: &[&str] = &["feed_url", "title", "subscribed", "added_at", "touched_at", "played_at", "store_id"];
const STATE_COLUMNS: &[&str] = &["feed_url", "episode_id", "played_at", "position", "play_count", "played"];

fn seconds(text: Option<&str>) -> Value {
    json!(text.and_then(|text| unix_seconds(text).ok()))
}

fn yes_no(text: Option<&str>) -> Option<i64> {
    match text?.trim().to_lowercase().as_str() {
        "yes" => Some(1),
        "no" => Some(0),
        _ => None,
    }
}

/// A feed is followed only where the export says «Yes»; the list of feeds merely played has no such column.
fn feed_values(feed: &PodcastFeed) -> Vec<Value> {
    vec![
        json!(feed.feed_url),
        json!(feed.title.as_deref().filter(|title| *title != "N/A")),
        json!(yes_no(feed.subscribed.as_deref()).unwrap_or(0)),
        seconds(feed.added_at.as_deref()),
        seconds(feed.touched_at.as_deref()),
        seconds(feed.played_at.as_deref()),
        json!(feed.store_id),
    ]
}

fn state_values(state: &PodcastState) -> Vec<Value> {
    vec![
        json!(state.feed_url),
        json!(state.episode_id),
        seconds(state.played_at.as_deref()),
        json!(state.position),
        json!(state.play_count),
        json!(yes_no(state.played.as_deref())),
    ]
}

pub fn job() -> Job<SqliteClient> {
    Job::import_folder("import-apple-podcasts", "keep the podcast feeds and episode states of Apple's data export in podcasts.db", |_, directory, dry_run| {
        let path = path_from_env("PODCAST_DB", "../../.data/podcasts.db");
        let podcasts = open_migrated(&path, podcasts::SCHEMA, "podcasts").context("opening the podcasts database")?;
        import(&podcasts, directory, dry_run)
    })
}

pub fn import(db: &SqliteClient, root: &Path, dry_run: bool) -> Result<()> {
    let feeds = read_podcast_feeds(root).context("reading the podcast feeds")?;
    let states = read_podcast_states(root).context("reading the episode states")?;
    println!("{} feeds, {} episode states", feeds.len(), states.len());
    if dry_run {
        println!("dry run: nothing written");
        return Ok(());
    }
    let mut statements = insert_statements("INSERT OR REPLACE INTO", "apple_podcast_feed", FEED_COLUMNS, feeds.iter().map(feed_values));
    statements.extend(insert_statements("INSERT OR REPLACE INTO", "apple_podcast_state", STATE_COLUMNS, states.iter().map(state_values)));
    db.execute_batch(&statements).context("writing the Apple podcast data")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(subscribed: Option<&str>, title: Option<&str>) -> PodcastFeed {
        PodcastFeed {
            feed_url: "https://example.org/feed".into(),
            title: title.map(str::to_string),
            subscribed: subscribed.map(str::to_string),
            added_at: None,
            touched_at: None,
            played_at: Some("2026-05-01T10:19:33.980Z".into()),
            store_id: None,
        }
    }

    #[test]
    fn a_feed_is_followed_only_when_the_export_says_yes() {
        assert_eq!(feed_values(&feed(Some("Yes"), Some("Show")))[2], json!(1));
        assert_eq!(feed_values(&feed(Some("No"), Some("Show")))[2], json!(0));
        assert_eq!(feed_values(&feed(None, None))[2], json!(0));
    }

    #[test]
    fn a_missing_title_and_a_played_time_are_kept_as_what_they_are() {
        let values = feed_values(&feed(None, Some("N/A")));
        assert_eq!(values[1], Value::Null);
        assert_eq!(values[5], json!(1_777_630_773));
    }

    #[test]
    fn an_unanswered_played_flag_is_not_no() {
        assert_eq!(yes_no(Some("")), None);
        assert_eq!(yes_no(Some("Yes")), Some(1));
    }

    #[test]
    fn the_same_states_written_twice_leave_one_row_each() {
        let db = SqliteClient::open(Path::new(":memory:")).unwrap();
        shared_data::app_db::apply_schema(&db, podcasts::SCHEMA).unwrap();
        let state = PodcastState { feed_url: "f".into(), episode_id: "e".into(), played_at: None, position: Some(1.5), play_count: Some(2), played: Some("Yes".into()) };
        for _ in 0..2 {
            let statements = insert_statements("INSERT OR REPLACE INTO", "apple_podcast_state", STATE_COLUMNS, [state_values(&state)]);
            db.execute_batch(&statements).unwrap();
        }
        let rows = db.query("SELECT COUNT(*) AS n FROM apple_podcast_state", &[]).unwrap();
        assert_eq!(rows[0]["n"].as_i64(), Some(1));
    }
}
