//! `import-apple <folder>`: Apple's own export of the Apple Music activity (folder
//! `Apple Music Activity` of `Apple_Media_Services.zip`, with the `.json.zip` files
//! unpacked beside the CSVs) into `apple_track`, `apple_play`, `apple_favorite`,
//! `apple_playlist` and `apple_playlist_track`. A play of 30 s or more that no
//! scrobble has also becomes a listen; skips and videos never do. Every key makes
//! a second run of the same export change nothing.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;

use anyhow::{Context, Result};
use serde_json::{json, Value};
use shared_data::apple_export::{
    read_favorites, read_library_tracks, read_play_ends, read_playlists, unix_seconds, LibraryTrack, PlayEnd,
};
use shared_data::batch::insert_statements;
use shared_data::job::Job;
use shared_data::sqlite_client::SqliteClient;

use crate::models::Listen;
use crate::sync::insert_listens;
use crate::twins::Existing;

/// What counts as a listen. Last.fm needs half the track or four minutes; here a share of the track is enough
/// (never under 30 s), because a pause or a scrub splits one listening into several plays in the export
/// (they are put together first, see `listenings`), and a track played to a third is a track heard.
const MIN_PLAYED_MS: i64 = 30_000;
const MIN_SHARE_PERCENT: i64 = 30;
/// Plays of one song that follow each other within this many seconds, the earlier one ended by a pause or a scrub and the
/// next one starting inside the track (one that starts at 0 is the song played again), are one listening.
const MERGE_GAP_SECS: i64 = 600;
const CONTINUING: &[&str] = &["SCRUB_BEGIN", "PLAYBACK_SUSPENDED", "PLAYBACK_MANUALLY_PAUSED", "OTHER"];

fn is_listen_long(total_ms: i64, media_ms: Option<i64>) -> bool {
    total_ms >= media_ms.map_or(MIN_PLAYED_MS, |length| (length * MIN_SHARE_PERCENT / 100).max(MIN_PLAYED_MS))
}

struct Event {
    play: PlayEnd,
    started_at: i64,
}

/// For each event (in start order): `Some(total)` when it opens a listening, the time played over all its plays, `None` when it
/// goes on one that an earlier event opened.
fn listenings(events: &[Event]) -> Vec<Option<i64>> {
    let mut totals: Vec<Option<i64>> = vec![None; events.len()];
    let mut open: HashMap<(String, String), (usize, i64, bool, i64)> = HashMap::new();
    for (index, event) in events.iter().enumerate() {
        let play = &event.play;
        let at = (key(play.song_name.as_deref().unwrap_or_default()), key(play.album_name.as_deref().unwrap_or_default()));
        let ms = play.play_ms.unwrap_or(0);
        let ended = play.ended_at.as_deref().and_then(|end| unix_seconds(end).ok()).unwrap_or(event.started_at + ms / 1000);
        let continues = play.end_reason.as_deref().is_some_and(|reason| CONTINUING.contains(&reason));
        match open.get_mut(&at) {
            // The export sometimes reports one play twice, under two event ids.
            Some((_, _, _, last_start)) if *last_start == event.started_at => {}
            Some((first, last_end, was_continuing, last_start))
                if *was_continuing && event.started_at - *last_end <= MERGE_GAP_SECS && play.start_position_ms.unwrap_or(1) > 0 =>
            {
                if let Some(total) = totals[*first].as_mut() {
                    *total += ms;
                }
                (*last_end, *was_continuing, *last_start) = (ended, continues, event.started_at);
            }
            _ => {
                totals[index] = Some(ms);
                open.insert(at, (index, ended, continues, event.started_at));
            }
        }
    }
    totals
}

const PLAY_COLUMNS: &[&str] = &[
    "event_id", "started_at", "ended_at", "song_name", "album_name", "artist_name", "track_id", "media_type", "play_ms",
    "media_ms", "end_reason", "container_type", "container_name", "feature", "device", "utc_offset", "shuffle",
    "listen_added",
];
const TRACK_COLUMNS: &[&str] = &[
    "track_id", "catalog_id", "content_type", "title", "artist", "album", "album_artist", "genre", "year",
    "track_number", "disc_number", "duration_ms", "release_date", "added_at", "play_count", "skip_count", "favorite",
];
const FAVORITE_COLUMNS: &[&str] = &["kind", "item_ref", "description", "preference", "modified_at"];
const PLAYLIST_COLUMNS: &[&str] = &["playlist_id", "kind", "title", "description", "parent_id", "added_at"];

const MARK_LISTEN_ADDED: &str = "UPDATE apple_play SET listen_added = 1 WHERE event_id = ?";
const CLEAR_PLAYLISTS: &str = "DELETE FROM apple_playlist";
const CLEAR_PLAYLIST_TRACKS: &str = "DELETE FROM apple_playlist_track";

fn key(text: &str) -> String {
    text.trim().to_lowercase()
}

/// Which library entry a play is: the play log names a song and an album, never an
/// artist or an id. Only a pair that points at one artist is trusted; a pair shared
/// by several artists (a compilation) stays unresolved rather than guessed.
#[derive(Debug, Default)]
pub struct Library(HashMap<(String, String), Vec<(i64, String)>>);

impl Library {
    pub fn new(tracks: &[LibraryTrack]) -> Self {
        let mut map: HashMap<(String, String), Vec<(i64, String)>> = HashMap::new();
        for track in tracks {
            if let (Some(title), Some(album), Some(artist)) = (&track.title, &track.album, &track.artist) {
                map.entry((key(title), key(album))).or_default().push((track.track_id, artist.clone()));
            }
        }
        Library(map)
    }

    /// The lowest library id and the artist, when every entry of the pair has the same artist.
    pub fn resolve(&self, song: &str, album: &str) -> Option<(i64, String)> {
        let entries = self.0.get(&(key(song), key(album)))?;
        let (first_id, artist) = entries.iter().min_by_key(|(id, _)| *id)?;
        entries.iter().all(|(_, other)| key(other) == key(artist)).then(|| (*first_id, artist.clone()))
    }
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Counts {
    pub plays: usize,
    pub videos: usize,
    pub skips: usize,
    pub merged: usize,
    pub unresolved: usize,
    pub already_listened: usize,
    pub hour_covered: usize,
    pub per_month_added: Vec<(String, usize)>,
}

pub struct PlayRow {
    pub play: PlayEnd,
    pub started_at: i64,
    pub artist: Option<(i64, String)>,
    pub listen_added: bool,
}

pub struct Plan {
    pub rows: Vec<PlayRow>,
    pub listens: Vec<Listen>,
    pub counts: Counts,
}

/// Listens already stored per hour (unix seconds / 3600).
pub type ListensPerHour = HashMap<i64, i64>;

fn counts_toward_listens(event: &Event, total_ms: i64) -> bool {
    event.play.media_type.as_deref() != Some("VIDEO") && is_listen_long(total_ms, event.play.media_ms)
}

/// Scrobblers and Apple name a track differently (a «- Single» album, a «(mixed)» tail) and
/// time it a little apart, so a name match alone misses twins. Each hour therefore gets at
/// most as many added listens as Apple has listenings beyond those already stored for it.
fn spare_per_hour(events: &[Event], totals: &[Option<i64>], stored: &ListensPerHour) -> HashMap<i64, i64> {
    let mut spare: HashMap<i64, i64> = HashMap::new();
    for (event, total) in events.iter().zip(totals) {
        if total.is_some_and(|total| counts_toward_listens(event, total)) {
            *spare.entry(event.started_at / 3600).or_default() += 1;
        }
    }
    for (hour, listenings_in_hour) in &mut spare {
        *listenings_in_hour -= stored.get(hour).copied().unwrap_or(0);
    }
    spare
}

pub fn plan(plays: Vec<PlayEnd>, library: &Library, existing: &mut Existing, stored: &ListensPerHour) -> Result<Plan> {
    let mut seen = HashSet::new();
    let mut events = Vec::new();
    for play in plays {
        let (Some(_), Some(start)) = (&play.song_name, play.started_at.as_deref()) else { continue };
        if seen.insert(play.event_id.clone()) {
            let started_at = unix_seconds(start)?;
            events.push(Event { play, started_at });
        }
    }
    events.sort_by_key(|event| event.started_at);
    let totals = listenings(&events);
    let mut spare = spare_per_hour(&events, &totals, stored);

    let eligible: Vec<usize> = (0..events.len())
        .filter(|&index| {
            let event = &events[index];
            totals[index].is_some_and(|total| counts_toward_listens(event, total))
                && library.resolve(event.play.song_name.as_deref().unwrap_or_default(), event.play.album_name.as_deref().unwrap_or_default()).is_some()
        })
        .collect();
    let asked: Vec<(&str, i64)> = eligible.iter().map(|&index| (events[index].play.song_name.as_deref().unwrap_or_default(), events[index].started_at)).collect();
    let twins: HashSet<usize> = eligible.iter().zip(existing.take_twins(&asked)).filter(|(_, twin)| *twin).map(|(index, _)| *index).collect();

    let mut counts = Counts::default();
    let mut rows = Vec::new();
    let mut listens = Vec::new();
    let mut per_month: BTreeMap<String, usize> = BTreeMap::new();

    for (index, (event, total)) in events.into_iter().zip(totals).enumerate() {
        let Event { play, started_at } = event;
        let song = play.song_name.clone().unwrap_or_default();
        let artist = library.resolve(&song, play.album_name.as_deref().unwrap_or_default());
        counts.plays += 1;

        let mut listen_added = false;
        match total {
            _ if play.media_type.as_deref() == Some("VIDEO") => counts.videos += 1,
            None => counts.merged += 1,
            Some(total) if !is_listen_long(total, play.media_ms) => counts.skips += 1,
            Some(total) => {
                if let Some((_, artist_name)) = &artist {
                    let hour_spare = spare.entry(started_at / 3600).or_default();
                    if twins.contains(&index) {
                        counts.already_listened += 1;
                    } else if *hour_spare <= 0 {
                        counts.hour_covered += 1;
                    } else {
                        *hour_spare -= 1;
                        let month = chrono::DateTime::from_timestamp(started_at, 0).map_or_else(String::new, |time| time.format("%Y-%m").to_string());
                        *per_month.entry(month).or_default() += 1;
                        listen_added = true;
                        listens.push(Listen {
                            listened_at: started_at,
                            track_name: song,
                            artist_name: artist_name.clone(),
                            release_name: play.album_name.clone(),
                            recording_mbid: None,
                            artist_mbid: None,
                            release_mbid: None,
                            duration_ms: Some(total),
                        });
                    }
                } else {
                    counts.unresolved += 1;
                }
            }
        }
        rows.push(PlayRow { play, started_at, artist, listen_added });
    }
    counts.per_month_added = per_month.into_iter().collect();
    Ok(Plan { rows, listens, counts })
}

fn seconds(text: Option<&str>) -> Value {
    json!(text.and_then(|text| unix_seconds(text).ok()))
}

fn play_values(row: &PlayRow) -> Vec<Value> {
    let play = &row.play;
    vec![
        json!(play.event_id),
        json!(row.started_at),
        seconds(play.ended_at.as_deref()),
        json!(play.song_name),
        json!(play.album_name),
        json!(row.artist.as_ref().map(|(_, artist)| artist)),
        json!(row.artist.as_ref().map(|(id, _)| id)),
        json!(play.media_type),
        json!(play.play_ms),
        json!(play.media_ms),
        json!(play.end_reason),
        json!(play.container_type),
        json!(play.container_name),
        json!(play.feature),
        json!(play.device),
        json!(play.utc_offset),
        json!(play.shuffle),
        json!(i64::from(row.listen_added)),
    ]
}

fn track_values(track: &LibraryTrack) -> Vec<Value> {
    vec![
        json!(track.track_id),
        json!(track.catalog_id),
        json!(track.content_type),
        json!(track.title),
        json!(track.artist),
        json!(track.album),
        json!(track.album_artist),
        json!(track.genre),
        json!(track.year),
        json!(track.track_number),
        json!(track.disc_number),
        json!(track.duration_ms),
        json!(track.release_date),
        seconds(track.added_at.as_deref()),
        json!(track.play_count),
        json!(track.skip_count),
        json!(track.favorite.map(i64::from)),
    ]
}

const LISTENS_PER_HOUR: &str = "SELECT listened_at / 3600 AS hour, COUNT(*) AS n FROM listens GROUP BY hour";

fn listens_per_hour(db: &SqliteClient) -> Result<ListensPerHour> {
    let rows = db.query(LISTENS_PER_HOUR, &[])?;
    Ok(rows.iter().filter_map(|row| Some((row["hour"].as_i64()?, row["n"].as_i64()?))).collect())
}

pub fn job() -> Job<SqliteClient> {
    Job::import_folder("import-apple", "keep Apple Music's own export (library, plays, favorites, playlists) and add the plays no scrobble has to listens", import)
}

pub fn import(db: &SqliteClient, directory: &Path, dry_run: bool) -> Result<()> {
    let file = |name: &str| directory.join(name);
    let tracks = read_library_tracks(&file("Apple Music Library Tracks.json"))
        .context("reading the library (unpack Apple Music Library Tracks.json.zip next to the CSV files)")?;
    let plays = read_play_ends(&file("Apple Music Play Activity.csv")).context("reading the play activity")?;
    let favorites = read_favorites(&file("Apple Music - Favorites.csv")).context("reading the favorites")?;
    let playlists = read_playlists(&file("Apple Music Library Playlists.json"))
        .context("reading the playlists (unpack Apple Music Library Playlists.json.zip next to the CSV files)")?;

    let library = Library::new(&tracks);
    let mut existing = Existing::load(db).context("reading the stored listens")?;
    let stored = listens_per_hour(db).context("counting the stored listens per hour")?;
    let Plan { rows, listens, counts } = plan(plays, &library, &mut existing, &stored)?;

    println!(
        "{} library entries, {} playlists, {} favorites; {} finished plays: {} videos, {} too short to count, {} continuing a listening already counted, {} on a song and album that name no single artist, {} already scrobbled, {} in hours the scrobbles already fill",
        tracks.len(), playlists.len(), favorites.len(), counts.plays, counts.videos, counts.skips, counts.merged, counts.unresolved, counts.already_listened, counts.hour_covered
    );
    for (month, added) in &counts.per_month_added {
        println!("  {month}: {added} listens to add");
    }
    if dry_run {
        println!("dry run: {} listens would be added, nothing written", listens.len());
        return Ok(());
    }

    let mut statements = vec![(CLEAR_PLAYLISTS.to_string(), vec![]), (CLEAR_PLAYLIST_TRACKS.to_string(), vec![])];
    statements.extend(insert_statements("INSERT OR REPLACE INTO", "apple_track", TRACK_COLUMNS, tracks.iter().map(track_values)));
    statements.extend(insert_statements(
        "INSERT OR REPLACE INTO",
        "apple_favorite",
        FAVORITE_COLUMNS,
        favorites.iter().map(|favorite| {
            vec![json!(favorite.kind), json!(favorite.item_ref), json!(favorite.description), json!(favorite.preference), seconds(favorite.modified_at.as_deref())]
        }),
    ));
    statements.extend(insert_statements(
        "INSERT OR REPLACE INTO",
        "apple_playlist",
        PLAYLIST_COLUMNS,
        playlists.iter().map(|list| {
            vec![json!(list.playlist_id), json!(list.kind), json!(list.title), json!(list.description), json!(list.parent_id), seconds(list.added_at.as_deref())]
        }),
    ));
    statements.extend(insert_statements(
        "INSERT OR REPLACE INTO",
        "apple_playlist_track",
        &["playlist_id", "position", "track_id"],
        playlists.iter().flat_map(|list| {
            list.items.iter().enumerate().map(|(position, track)| vec![json!(list.playlist_id), json!(position), json!(track)])
        }),
    ));
    statements.extend(insert_statements("INSERT OR IGNORE INTO", "apple_play", PLAY_COLUMNS, rows.iter().map(play_values)));
    // A play stored by an earlier run keeps its row (`OR IGNORE`), so the flag of one that has become a listen since is set here.
    statements.extend(rows.iter().filter(|row| row.listen_added).map(|row| (MARK_LISTEN_ADDED.to_string(), vec![json!(row.play.event_id)])));
    db.execute_batch(&statements).context("writing the Apple Music data")?;
    insert_listens(db, &listens).context("writing the listens")?;
    println!("kept the export; added {} listens", listens.len());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(id: i64, title: &str, album: &str, artist: &str) -> LibraryTrack {
        LibraryTrack {
            track_id: id,
            content_type: None,
            title: Some(title.into()),
            artist: Some(artist.into()),
            album: Some(album.into()),
            album_artist: None,
            genre: None,
            year: None,
            track_number: None,
            disc_number: None,
            duration_ms: None,
            release_date: None,
            added_at: None,
            play_count: None,
            skip_count: None,
            catalog_id: None,
            favorite: None,
        }
    }

    fn play(id: &str, start: &str, ms: i64, song: &str, media: &str) -> PlayEnd {
        PlayEnd {
            event_id: id.into(),
            event_type: "PLAY_END".into(),
            started_at: Some(start.into()),
            ended_at: None,
            song_name: Some(song.into()),
            album_name: Some("Album".into()),
            play_ms: Some(ms),
            media_ms: None,
            end_reason: None,
            start_position_ms: None,
            media_type: Some(media.into()),
            container_type: None,
            container_name: None,
            feature: None,
            device: None,
            utc_offset: None,
            shuffle: None,
        }
    }

    const START: &str = "2025-02-10T06:15:26.061Z";
    const START_SECS: i64 = 1_739_168_126;

    fn library() -> Library {
        Library::new(&[track(2, "Song", "Album", "Artist"), track(1, "Song", "Album", "artist"), track(3, "Mixed", "Album", "A"), track(4, "Mixed", "Album", "B")])
    }

    fn run(plays: Vec<PlayEnd>, known: &[(&str, i64)]) -> Plan {
        let mut existing = Existing::default();
        let mut stored = ListensPerHour::new();
        for (name, at) in known {
            existing.add(name, *at);
            *stored.entry(at / 3600).or_default() += 1;
        }
        plan(plays, &library(), &mut existing, &stored).unwrap_or_else(|error| panic!("{error}"))
    }

    #[test]
    fn a_song_and_album_with_one_artist_resolves_to_the_lowest_id() {
        assert_eq!(library().resolve("SONG", " album"), Some((1, "artist".to_string())));
    }

    #[test]
    fn a_pair_shared_by_two_artists_is_not_guessed() {
        assert_eq!(library().resolve("Mixed", "Album"), None);
    }

    #[test]
    fn skips_videos_and_unresolved_songs_are_kept_but_never_become_listens() {
        let plan = run(
            vec![
                play("1", START, 29_999, "Song", "AUDIO"),
                play("2", START, 200_000, "Song", "VIDEO"),
                play("3", START, 200_000, "Mixed", "AUDIO"),
            ],
            &[],
        );
        assert_eq!(plan.rows.len(), 3);
        assert!(plan.listens.is_empty());
        assert_eq!((plan.counts.skips, plan.counts.videos, plan.counts.unresolved), (1, 1, 1));
    }

    #[test]
    fn a_listen_needs_a_third_of_the_track_and_at_least_thirty_seconds() {
        assert!(!is_listen_long(59_999, Some(200_000)));
        assert!(is_listen_long(60_000, Some(200_000)));
        assert!(!is_listen_long(29_999, Some(60_000)));
        assert!(is_listen_long(30_000, None));
    }

    fn ending(mut play: PlayEnd, reason: &str, ended: &str) -> PlayEnd {
        play.end_reason = Some(reason.into());
        play.ended_at = Some(ended.into());
        play
    }

    #[test]
    fn plays_split_by_a_scrub_are_one_listening_that_counts_once() {
        let mut first = ending(play("1", START, 20_000, "Song", "AUDIO"), "SCRUB_BEGIN", "2025-02-10T06:15:46.000Z");
        let mut second = play("2", "2025-02-10T06:15:47.000Z", 20_000, "Song", "AUDIO");
        (first.media_ms, second.media_ms) = (Some(100_000), Some(100_000));
        let plan = run(vec![first, second], &[]);
        assert_eq!(plan.listens.len(), 1);
        assert_eq!((plan.listens[0].listened_at, plan.listens[0].duration_ms), (START_SECS, Some(40_000)));
        assert_eq!((plan.counts.merged, plan.rows.len()), (1, 2));
    }

    #[test]
    fn a_track_that_ended_or_was_skipped_is_not_continued_by_the_next_play() {
        let first = ending(play("1", START, 20_000, "Song", "AUDIO"), "TRACK_SKIPPED_FORWARDS", "2025-02-10T06:15:46.000Z");
        let second = play("2", "2025-02-10T06:15:47.000Z", 20_000, "Song", "AUDIO");
        assert_eq!(run(vec![first, second], &[]).counts.merged, 0);
    }

    #[test]
    fn a_pause_longer_than_the_gap_starts_a_new_listening() {
        let first = ending(play("1", START, 20_000, "Song", "AUDIO"), "PLAYBACK_MANUALLY_PAUSED", "2025-02-10T06:15:46.000Z");
        let later = play("2", "2025-02-10T07:15:47.000Z", 20_000, "Song", "AUDIO");
        assert_eq!(run(vec![first, later], &[]).counts.merged, 0);
    }

    #[test]
    fn a_scrobble_near_the_start_means_the_play_is_not_added_again() {
        let plan = run(vec![play("1", START, 200_000, "Song", "AUDIO")], &[("song", START_SECS + 40)]);
        assert!(plan.listens.is_empty());
        assert_eq!(plan.counts.already_listened, 1);
    }

    #[test]
    fn a_scrobble_with_another_name_in_the_same_hour_stops_the_play_being_added() {
        let plan = run(vec![play("1", START, 200_000, "Song", "AUDIO")], &[("prada", START_SECS + 600)]);
        assert!(plan.listens.is_empty());
        assert_eq!(plan.counts.hour_covered, 1);
    }

    #[test]
    fn two_plays_in_an_hour_with_one_scrobble_add_one() {
        let plays = vec![play("1", START, 200_000, "Song", "AUDIO"), play("2", "2025-02-10T06:40:00.000Z", 200_000, "Song", "AUDIO")];
        let plan = run(plays, &[("other", START_SECS + 5)]);
        assert_eq!((plan.listens.len(), plan.counts.hour_covered), (1, 1));
    }

    #[test]
    fn a_new_play_becomes_a_listen_with_the_exact_start_and_the_library_artist() {
        let plan = run(vec![play("1", START, 200_000, "Song", "AUDIO")], &[]);
        assert_eq!((plan.listens[0].listened_at, plan.listens[0].artist_name.as_str()), (START_SECS, "artist"));
        assert!(plan.rows[0].listen_added);
    }

    #[test]
    fn the_same_event_twice_in_the_export_counts_once() {
        let plan = run(vec![play("1", START, 200_000, "Song", "AUDIO"), play("1", START, 200_000, "Song", "AUDIO")], &[]);
        assert_eq!((plan.rows.len(), plan.listens.len()), (1, 1));
    }

    #[test]
    fn a_second_run_over_the_same_plays_adds_nothing() {
        let none = ListensPerHour::new();
        let first = plan(vec![play("1", START, 200_000, "Song", "AUDIO")], &library(), &mut Existing::default(), &none).unwrap_or_else(|error| panic!("{error}"));
        let mut stored = Existing::default();
        stored.add("Song", first.listens[0].listened_at);
        let counts = ListensPerHour::from([(START_SECS / 3600, 1)]);
        let again = plan(vec![play("1", START, 200_000, "Song", "AUDIO")], &library(), &mut stored, &counts).unwrap_or_else(|error| panic!("{error}"));
        assert_eq!((first.listens.len(), again.listens.len()), (1, 0));
    }

    #[test]
    fn a_song_played_again_right_after_is_a_second_listen() {
        let again = play("2", "2025-02-10T06:19:00.000Z", 200_000, "Song", "AUDIO");
        let plan = run(vec![play("1", START, 200_000, "Song", "AUDIO"), again], &[]);
        assert_eq!(plan.listens.len(), 2);
    }

    #[test]
    fn two_plays_in_a_row_with_one_scrobble_add_the_one_that_is_missing() {
        let again = play("2", "2025-02-10T06:19:00.000Z", 200_000, "Song", "AUDIO");
        let plan = run(vec![play("1", START, 200_000, "Song", "AUDIO"), again], &[("song", START_SECS + 5)]);
        assert_eq!((plan.listens.len(), plan.counts.already_listened), (1, 1));
    }

    #[test]
    fn one_play_reported_twice_under_two_event_ids_is_one_listen() {
        let plan = run(vec![play("1", START, 200_000, "Song", "AUDIO"), play("2", START, 200_000, "Song", "AUDIO")], &[]);
        assert_eq!((plan.listens.len(), plan.rows.len()), (1, 2));
    }

    #[test]
    fn a_play_that_starts_over_after_a_pause_is_a_new_listening() {
        let first = ending(play("1", START, 70_000, "Song", "AUDIO"), "PLAYBACK_MANUALLY_PAUSED", "2025-02-10T06:16:36.000Z");
        let mut restart = play("2", "2025-02-10T06:17:00.000Z", 70_000, "Song", "AUDIO");
        let mut resume = restart.clone();
        (restart.start_position_ms, resume.start_position_ms) = (Some(0), Some(70_000));
        resume.event_id = "3".into();
        assert_eq!(run(vec![first.clone(), restart], &[]).counts.merged, 0);
        assert_eq!(run(vec![first, resume], &[]).counts.merged, 1);
    }

}
