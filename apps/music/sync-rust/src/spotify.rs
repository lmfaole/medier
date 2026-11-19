//! Adds the music plays of a Spotify "Extended streaming history" export to
//! `listens`. The plays since 2021 are mostly in ListenBrainz already, so a row
//! is only added when no listen of the same track started near it. Podcast
//! episodes are not music and are left out; skips are not plays.

use std::path::Path;

use anyhow::{Context, Result};
use shared_data::spotify_export::{read_audio_rows, StreamingRow};
use shared_data::job::Job;
use shared_data::sqlite_client::SqliteClient;

use crate::models::Listen;
use crate::sync::insert_listens;
use crate::twins::Existing;

/// Under this a play was a skip; ListenBrainz would not have counted it either.
const MIN_PLAYED_MS: i64 = 30_000;

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Counts {
    pub read: usize,
    pub episodes: usize,
    pub skips: usize,
    pub already_listened: usize,
    pub per_year_added: Vec<(i32, usize)>,
}

pub struct Plan {
    pub listens: Vec<Listen>,
    pub counts: Counts,
}

pub fn plan(rows: &[StreamingRow], existing: &mut Existing) -> Result<Plan> {
    let mut counts = Counts { read: rows.len(), ..Counts::default() };
    let mut listens = Vec::new();
    let mut per_year: std::collections::BTreeMap<i32, usize> = std::collections::BTreeMap::new();

    for row in rows {
        let (Some(track), Some(artist)) =
            (&row.master_metadata_track_name, &row.master_metadata_album_artist_name)
        else {
            if row.episode_name.is_some() {
                counts.episodes += 1;
            }
            continue;
        };
        if row.ms_played < MIN_PLAYED_MS {
            counts.skips += 1;
            continue;
        }
        let started_at = row.started_at()?;
        if existing.has_twin(track, started_at) {
            counts.already_listened += 1;
            continue;
        }
        // Later rows of the export itself are held to the same rule.
        existing.add(track, started_at);
        *per_year.entry(year_of(started_at)).or_default() += 1;
        listens.push(Listen {
            listened_at: started_at,
            track_name: track.clone(),
            artist_name: artist.clone(),
            release_name: row.master_metadata_album_album_name.clone(),
            recording_mbid: None,
            artist_mbid: None,
            release_mbid: None,
            duration_ms: Some(row.ms_played),
        });
    }
    counts.per_year_added = per_year.into_iter().collect();
    Ok(Plan { listens, counts })
}

pub(crate) fn year_of(unix_seconds: i64) -> i32 {
    use chrono::Datelike;
    chrono::DateTime::from_timestamp(unix_seconds, 0).map_or(0, |time| time.year())
}

pub fn job() -> Job<SqliteClient> {
    Job::import_folder("import-spotify", "add the music plays of a Spotify export, skipping those ListenBrainz has", import)
}

pub fn import(db: &SqliteClient, directory: &Path, dry_run: bool) -> Result<()> {
    let rows = read_audio_rows(directory).context("reading the Spotify export")?;
    let mut existing = Existing::load(db).context("reading the stored listens")?;
    let Plan { listens, counts } = plan(&rows, &mut existing)?;

    println!(
        "read {} rows: {} episodes, {} skips under 30 s, {} already in ListenBrainz",
        counts.read, counts.episodes, counts.skips, counts.already_listened
    );
    for (year, added) in &counts.per_year_added {
        println!("  {year}: {added} to add");
    }
    if dry_run {
        println!("dry run: {} listens would be added, nothing written", listens.len());
        return Ok(());
    }
    let before = count_listens(db)?;
    insert_listens(db, &listens).context("writing the listens")?;
    println!("added {} listens", count_listens(db)? - before);
    Ok(())
}

fn count_listens(db: &SqliteClient) -> Result<i64> {
    let rows = db.query("SELECT COUNT(*) AS n FROM listens", &[])?;
    Ok(rows.first().and_then(|row| row["n"].as_i64()).unwrap_or(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(ts: &str, ms: i64, name: &str) -> StreamingRow {
        row(ts, ms, Some(name), None)
    }

    fn row(ts: &str, ms: i64, track: Option<&str>, episode: Option<&str>) -> StreamingRow {
        StreamingRow {
            ts: ts.to_string(),
            ms_played: ms,
            platform: None,
            reason_end: None,
            master_metadata_track_name: track.map(str::to_string),
            master_metadata_album_artist_name: track.map(|_| "Artist".to_string()),
            master_metadata_album_album_name: Some("Album".to_string()),
            episode_name: episode.map(str::to_string),
            episode_show_name: None,
            spotify_episode_uri: None,
        }
    }

    // 2024-05-29T13:40:00Z is 1_716_990_000.
    const END: &str = "2024-05-29T13:40:00Z";
    const END_SECS: i64 = 1_716_990_000;

    fn plan_of(rows: &[StreamingRow], existing: Vec<(&str, i64)>) -> Plan {
        let mut index = Existing::default();
        for (name, at) in existing {
            index.add(name, at);
        }
        plan(rows, &mut index).unwrap_or_else(|error| panic!("{error}"))
    }

    #[test]
    fn skips_and_episodes_are_counted_and_left_out() {
        let rows = [track(END, 29_999, "Skipped"), row(END, 900_000, None, Some("Episode"))];
        let plan = plan_of(&rows, vec![]);
        assert!(plan.listens.is_empty());
        assert_eq!((plan.counts.skips, plan.counts.episodes), (1, 1));
    }

    #[test]
    fn a_listenbrainz_twin_near_the_start_is_not_added_again() {
        let plan = plan_of(&[track(END, 200_000, "Song")], vec![("song", END_SECS - 200 + 40)]);
        assert!(plan.listens.is_empty());
        assert_eq!(plan.counts.already_listened, 1);
    }

    #[test]
    fn the_same_song_hours_later_is_a_new_play() {
        let plan = plan_of(&[track(END, 200_000, "Song")], vec![("song", END_SECS - 7200)]);
        assert_eq!(plan.listens.len(), 1);
    }

    #[test]
    fn a_duplicate_row_inside_the_export_is_added_once() {
        let plan = plan_of(&[track(END, 200_000, "Song"), track(END, 200_000, "Song")], vec![]);
        assert_eq!(plan.listens.len(), 1);
    }
}
