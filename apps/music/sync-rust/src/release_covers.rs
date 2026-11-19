//! Covers for listens ListenBrainz' metadata gave none for, asked of the Cover Art Archive directly: first the release
//! the listen itself names, then the release group of its recording (any of its releases that has a front picture).
//! The newest listens first, so the front page's «Nylig spilt» fills up. A release the archive has nothing on still gets
//! a row (no image), so it is not asked again.

use std::time::Duration;

use anyhow::{Context, Result};
use reqwest::StatusCode;
use serde_json::{json, Value};
use shared_data::http::{self, Budget, FailureStreak};
use shared_data::sqlite_client::SqliteClient;

use crate::scope::music_only;

const ARCHIVE: &str = "https://coverartarchive.org";
const PAUSE: Duration = Duration::from_millis(300);
// A slow archive must not use up the whole sync: what is left is asked again next run.
const BUDGET: Duration = Duration::from_mins(5);
const GIVE_UP_AFTER: u32 = 5;
const ATTEMPTS: u32 = 2;

const SQL_RELEASES: &str = concat!(
    "SELECT listens.release_mbid AS id FROM listens LEFT JOIN recording_metadata USING (recording_mbid) \
     WHERE listens.release_mbid IS NOT NULL AND recording_metadata.caa_id IS NULL \
       AND listens.release_mbid NOT IN (SELECT source_mbid FROM release_cover) AND ",
    music_only!(),
    " GROUP BY id ORDER BY MAX(listens.listened_at) DESC LIMIT ?"
);
const SQL_GROUPS: &str = concat!(
    "SELECT recording_metadata.release_group_mbid AS id FROM listens JOIN recording_metadata USING (recording_mbid) \
     LEFT JOIN release_cover ON release_cover.source_mbid = listens.release_mbid \
     WHERE recording_metadata.caa_id IS NULL AND recording_metadata.release_group_mbid IS NOT NULL \
       AND release_cover.caa_id IS NULL \
       AND recording_metadata.release_group_mbid NOT IN (SELECT source_mbid FROM release_cover) AND ",
    music_only!(),
    " GROUP BY id ORDER BY MAX(listens.listened_at) DESC LIMIT ?"
);
const SQL_STORE: &str = "INSERT OR REPLACE INTO release_cover (source_mbid, caa_release_mbid, caa_id, fetched_at) VALUES (?, ?, ?, ?)";

/// The release and image of an archive answer's front picture, or of its first one when none is marked as the front.
/// A release group's answer names the release the pictures belong to; a release's own answer is that release.
fn front_cover(answer: &Value, asked: &str) -> Option<(String, i64)> {
    let images = answer["images"].as_array()?;
    let image = images.iter().find(|image| image["front"] == true).or_else(|| images.first())?;
    let id = image["id"].as_i64().or_else(|| image["id"].as_str()?.parse().ok())?;
    let release = match answer["release"].as_str() {
        Some(address) => address.rsplit('/').next()?.to_string(),
        None => asked.to_string(),
    };
    Some((release, id))
}

fn ask(client: &reqwest::blocking::Client, kind: &str, id: &str) -> Result<Option<(String, i64)>> {
    std::thread::sleep(PAUSE);
    let address = format!("{ARCHIVE}/{kind}/{id}");
    let response = http::get_with_retry(client, &address, ATTEMPTS)?;
    match response.status() {
        StatusCode::NOT_FOUND => Ok(None),
        status if status.is_success() => {
            let answer: Value = response.json().with_context(|| format!("reading the answer of {address}"))?;
            Ok(front_cover(&answer, id))
        }
        // A server error is not an answer about the release: left unstored, it is asked again next run.
        status => Err(anyhow::anyhow!("{address} answered {status}")),
    }
}

fn pending(db: &SqliteClient, sql: &str, limit: usize) -> Result<Vec<String>> {
    Ok(db.query(sql, &[json!(limit)])?.iter().filter_map(|row| row["id"].as_str().map(str::to_string)).collect())
}

/// Asks the archive about at most `limit` releases, then release groups, newest listen first.
pub fn run(db: &SqliteClient, limit: usize) -> Result<()> {
    let client = http::client("music-sync/0.1 (+https://sky.lmfaole.party/apps/medier/musikk)")?;
    let budget = Budget::new(BUDGET);
    let mut streak = FailureStreak::new(GIVE_UP_AFTER);
    let now = chrono::Utc::now().timestamp();
    let (mut asked, mut found) = (0, 0);
    'kinds: for (kind, sql) in [("release", SQL_RELEASES), ("release-group", SQL_GROUPS)] {
        for id in pending(db, sql, limit.saturating_sub(asked))? {
            if budget.is_spent() {
                println!("release-covers: out of time, the rest is asked next run");
                break 'kinds;
            }
            asked += 1;
            let answer = ask(&client, kind, &id).inspect_err(|error| println!("release-covers: {error:#}"));
            if streak.record(answer.is_ok()) {
                println!("release-covers: {GIVE_UP_AFTER} failures in a row, the archive is left for next run");
                break 'kinds;
            }
            let Ok(cover) = answer else { continue };
            found += usize::from(cover.is_some());
            let (release, image) = cover.unzip();
            db.execute(SQL_STORE, &[json!(id), json!(release), json!(image), json!(now)])?;
        }
    }
    println!("release-covers: {asked} asked, {found} with a front picture");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_release_gives_its_front_picture_and_a_group_the_release_it_came_from() {
        let release = json!({"images": [{"id": "1", "front": false}, {"id": "22", "front": true}]});
        assert_eq!(front_cover(&release, "rel"), Some(("rel".to_string(), 22)));
        let group = json!({"release": "http://musicbrainz.org/release/abc", "images": [{"id": 7, "front": false}]});
        assert_eq!(front_cover(&group, "grp"), Some(("abc".to_string(), 7)));
        assert_eq!(front_cover(&json!({"images": []}), "rel"), None);
    }
}
