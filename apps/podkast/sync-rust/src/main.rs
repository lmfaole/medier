mod db;
mod feeds;
mod gpoddersync;
mod mapping;
mod util;

use anyhow::{Context, Result};
use chrono::Utc;
use serde_json::{json, Value};
use shared_data::app_db::path_from_env;
use std::collections::HashMap;

fn is_completed(action: &str, position: i64, total: i64) -> bool {
    let a = action.to_ascii_uppercase();
    if a == "FINISH" || a == "COMPLETED" || a == "PLAYED" || a == "PLAYED_FULLY" {
        return true;
    }
    if total > 0 && position >= total * 95 / 100 {
        return true;
    }
    false
}

fn main() -> Result<()> {
    let export = gpoddersync::export_path();
    println!("Using export: {}", export.display());
    let actions = gpoddersync::read_actions(&export)?;
    println!("Read {} actions", actions.len());

    let db_path = path_from_env("PODCAST_HISTORY_DB", "../../.data/podcast_history.db");
    let history_db = db::open_history_db(&db_path)?;
    let podcasts_db = path_from_env("PODCAST_DB", "../../.data/podcasts.db");

    let shows = mapping::show_names(&podcasts_db)?;
    let mut feeds = feeds::Feeds::open(shows)?;
    let imported_at = Utc::now().to_rfc3339();
    let mut series_cache: HashMap<String, Option<(String, Option<String>)>> = HashMap::new();
    let mut batch: Vec<(String, Vec<Value>)> = Vec::with_capacity(actions.len());
    let mut unmapped = 0;
    for a in &actions {
        let episode_key = util::extract_episode_key(a.guid.as_deref(), &a.episode);
        // 1) Try direct guid match across all shows (fastest, most reliable)
        let mut series_key_opt: Option<String> = None;
        let mut series_title_opt: Option<String> = None;
        let mut ep_title_opt: Option<String> = None;
        if let Some((show_name, _g, title)) = mapping::find_by_guid(&podcasts_db, &episode_key)? {
            series_key_opt = Some(show_name.clone());
            ep_title_opt = title;
            series_title_opt = mapping::find_series_title_by_name(&podcasts_db, &show_name)?;
        }
        if series_key_opt.is_none() {
            let series_info = if let Some(cached) = series_cache.get(&a.podcast) {
                cached.clone()
            } else {
                let found = mapping::find_series_key_by_rss(&podcasts_db, &a.podcast)?;
                let val = found.as_ref().map(|s| (s.series_key.clone(), s.series_title.clone()));
                series_cache.insert(a.podcast.clone(), val.clone());
                val
            };
            if let Some((sk, st)) = series_info {
                series_key_opt = Some(sk);
                series_title_opt = st;
                let ep_info = mapping::find_episode_mapping(&podcasts_db, series_key_opt.as_deref().unwrap_or(""), &a.episode, a.guid.as_deref()).ok().flatten();
                ep_title_opt = ep_info.and_then(|e| e.episode_title);
            }
        }
        // The feed the player listens through says what Apple's directory does not: a mirror of a show's feed, and the title of an episode.
        let from_feed = if series_key_opt.is_none() || ep_title_opt.is_none() { feeds.about(&a.podcast, &a.episode, a.guid.as_deref()) } else { None };
        if let Some(found) = &from_feed {
            if series_key_opt.is_none() {
                series_title_opt = mapping::find_series_title_by_name(&podcasts_db, &found.show)?.or_else(|| Some(found.show.clone()));
                series_key_opt = Some(found.show.clone());
            }
            if ep_title_opt.is_none() {
                ep_title_opt.clone_from(&found.episode_title);
            }
        }
        let (series_key, series_title) = if let (Some(sk), st) = (series_key_opt, series_title_opt) { (sk, st) } else {
            unmapped += 1;
            // Fallback: not found in podcasts.db (a feed's episode older than the feed keeps, or an
            // unregistered show). Use the podcast feed URL itself as series_key so the log stays
            // complete; the UI derives a display label from the URL when title is null.
            (util::normalize_url(&a.podcast), None)
        };
        let completed = i32::from(is_completed(&a.action, a.position, a.total));
        // gpoddersync stores the time as `timestamp_epoch`; fill the ISO `timestamp` column from it
        // when the plain `timestamp` column is empty, so the UI always has a renderable time.
        let timestamp_iso = a.timestamp.clone().or_else(|| {
            if a.timestamp_epoch > 0 {
                chrono::DateTime::from_timestamp(a.timestamp_epoch, 0).map(|dt| dt.to_rfc3339())
            } else {
                None
            }
        });
        // Fallback display labels for a row with no podcasts.db match, so the UI always has
        // something readable without needing its own URL-to-label logic.
        let series_title = series_title.or_else(|| util::derive_label_from_url(&series_key));
        let ep_title_opt = ep_title_opt.or_else(|| util::derive_label_from_url(&a.episode));
        batch.push((
            "INSERT OR REPLACE INTO episode_actions
            (id, episode_key, series_key, episode_url, guid, action, position, started, total, timestamp, timestamp_epoch, completed, series_title, episode_title, imported_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)"
                .to_string(),
            vec![
                json!(a.id),
                json!(episode_key),
                json!(series_key),
                json!(a.episode),
                json!(a.guid),
                json!(a.action),
                json!(a.position),
                json!(a.started),
                json!(a.total),
                json!(timestamp_iso),
                json!(a.timestamp_epoch),
                json!(completed),
                json!(series_title),
                json!(ep_title_opt),
                json!(imported_at),
            ],
        ));
    }
    history_db.execute_batch(&batch).context("inserting the actions")?;
    println!("Inserted {} actions ({unmapped} with no podcasts.db match, used the feed URL as key)", batch.len());
    Ok(())
}
