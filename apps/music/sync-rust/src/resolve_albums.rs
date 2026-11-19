//! `resolve-albums <limit>`: gives MusicBrainz ids to the listens that have none by asking for the album, not the
//! track. The album's title is cleaned of «Deluxe», «Expanded», «- Single» and the like, MusicBrainz is searched for a
//! release of that title by that artist, and when several fit the one that came out the year Apple's library says
//! wins. The release's tracklist then gives each unmapped track of the album its recording. Each answer is landed
//! unchanged under `.data/raw/musicbrainz/<date>/`; an album with no result is not asked again for a quarter of a year.

use anyhow::{Context, Result};
use serde_json::{json, Value};
use shared_data::job::Job;
use shared_data::shelf::landing;
use shared_data::sqlite_client::SqliteClient;
use shared_data::tmdb::land;

use crate::album_key::album_search_title;
use crate::album_tracklist::{tracks_of, TrackRow};
use crate::musicbrainz_extra::get;
use crate::names::{core_title, fold, same_artist, same_title};
use crate::resolve::{apply, Found, Pair, SQL_RESET_ENRICH_CURSOR};

const API: &str = "https://musicbrainz.org/ws/2";
/// MusicBrainz' own match score; below this a release is a guess.
const MIN_SCORE: i64 = 90;
const RETRY_AFTER_DAYS: i64 = 90;
/// Releases of one album read for its tracklist: the fullest edition may be the third that fits.
const MAX_RELEASES_PER_ALBUM: usize = 3;

const SQL_PENDING: &str = "SELECT artist_name, release_name, COUNT(*) AS plays FROM listens \
    WHERE recording_mbid IS NULL AND release_name IS NOT NULL AND release_name != '' \
      AND NOT EXISTS (SELECT 1 FROM resolve_album_attempts a WHERE a.artist_name = listens.artist_name \
                      AND a.release_name = listens.release_name AND a.tried_at > ?) \
    GROUP BY artist_name, release_name ORDER BY plays DESC, artist_name, release_name LIMIT ?";
const SQL_TRACKS: &str = "SELECT track_name, COUNT(*) AS plays FROM listens \
    WHERE recording_mbid IS NULL AND artist_name = ? AND release_name = ? GROUP BY track_name";
// The year most of the library's tracks on this album say, which names the edition the owner has.
const SQL_YEAR: &str = "SELECT year FROM apple_track WHERE year > 0 AND lower(album) = lower(?) GROUP BY year ORDER BY COUNT(*) DESC LIMIT 1";
const SQL_RECORD: &str = "INSERT OR REPLACE INTO resolve_album_attempts (artist_name, release_name, outcome, tried_at) VALUES (?, ?, ?, ?)";

/// A MusicBrainz query value in quotes, so a quote or a backslash in a title cannot end it.
fn quoted(text: &str) -> String {
    format!("\"{}\"", text.replace('\\', "").replace('"', "\\\""))
}

/// A collaboration is listened to as «A, B & C»; any one of them credited makes the release the artist's.
fn artist_parts(artist: &str) -> Vec<&str> {
    let mut parts = vec![artist];
    parts.extend(artist.split([',', '&']).map(str::trim).filter(|part| !part.is_empty() && *part != artist));
    parts
}

fn credited_as(artist: &str, release: &Value) -> bool {
    let credits: Vec<&str> = release["artist-credit"].as_array().into_iter().flatten().filter_map(|credit| credit["name"].as_str()).collect();
    artist_parts(artist).iter().any(|part| credits.iter().any(|name| same_artist(part, name)))
}

/// The releases of a search answer that are the album: its cleaned title, the artist, a score that leaves little doubt.
/// In the order to try them: the one released in `year` first, then the official ones, then the fullest.
pub fn candidate_releases(answer: &Value, artist: &str, album: &str, year: Option<i64>) -> Vec<String> {
    let wanted = fold(&album_search_title(album));
    let mut fits: Vec<&Value> = answer["releases"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|release| {
            release["score"].as_i64().unwrap_or_default() >= MIN_SCORE
                && release["title"].as_str().is_some_and(|title| fold(&album_search_title(title)) == wanted)
                && credited_as(artist, release)
        })
        .collect();
    let released = |release: &Value| release["date"].as_str().and_then(|date| date.get(..4)).and_then(|year| year.parse::<i64>().ok());
    fits.sort_by_key(|release| {
        (
            year.is_none_or(|year| released(release) != Some(year)),
            release["status"].as_str() != Some("Official"),
            -release["track-count"].as_i64().unwrap_or_default(),
        )
    });
    fits.iter().filter_map(|release| release["id"].as_str().map(str::to_string)).collect()
}

/// For each wanted track title the recording of the tracklist with that title; failing that, with the same core title
/// (the tracklist's «Hello» for «Hello - Live», «Romeo» for «Romeo + Guest»), which is safe because the tracklist is one album's.
pub fn match_tracks<'a>(tracks: &'a [TrackRow], wanted: &[String]) -> Vec<(String, &'a TrackRow)> {
    let with_id = || tracks.iter().filter(|track| track.recording_mbid.is_some());
    wanted
        .iter()
        .filter_map(|title| {
            let exact = with_id().find(|track| same_title(title, &track.title));
            let core = || with_id().find(|track| !fold(core_title(&track.title)).is_empty() && fold(core_title(title)) == fold(core_title(&track.title)));
            exact.or_else(core).map(|track| (title.clone(), track))
        })
        .collect()
}

#[derive(Debug, Default)]
struct Summary {
    matched: usize,
    partial: usize,
    missing: usize,
    listens: usize,
}

fn record(db: &SqliteClient, artist: &str, album: &str, outcome: &str) -> Result<()> {
    db.execute(SQL_RECORD, &[json!(artist), json!(album), json!(outcome), json!(chrono::Utc::now().timestamp())])
}

fn year_hint(db: &SqliteClient, album: &str) -> Result<Option<i64>> {
    Ok(db.query(SQL_YEAR, &[json!(album)])?.first().and_then(|row| row["year"].as_i64()))
}

fn resolve_album(db: &SqliteClient, client: &reqwest::blocking::Client, directory: &std::path::Path, artist: &str, album: &str, summary: &mut Summary) -> Result<()> {
    let wanted: Vec<(String, i64)> =
        db.query(SQL_TRACKS, &[json!(artist), json!(album)])?.iter().filter_map(|row| Some((row["track_name"].as_str()?.to_string(), row["plays"].as_i64()?))).collect();
    let titles: Vec<String> = wanted.iter().map(|(title, _)| title.clone()).collect();
    // For a collaboration, the first of the names: MusicBrainz' phrase search for the whole line finds nothing.
    let search_artist = artist_parts(artist).get(1).copied().unwrap_or(artist);
    let query = format!("release:{} AND artist:{}", quoted(&album_search_title(album)), quoted(&search_artist.replace('’', "'")));
    let candidates = match get(client, &format!("{API}/release"), &[("query", &query), ("limit", "25"), ("fmt", "json")])? {
        Some(answer) => {
            land(&directory.join(format!("album-search-{}.json", shared_data::text::slug(&format!("{artist} {album}")))), &answer)?;
            candidate_releases(&answer, artist, album, year_hint(db, album)?)
        }
        None => Vec::new(),
    };
    let mut remaining = titles.clone();
    for release in candidates.iter().take(MAX_RELEASES_PER_ALBUM) {
        let Some(answer) = get(client, &format!("{API}/release/{release}"), &[("inc", "recordings+artist-credits"), ("fmt", "json")])? else { continue };
        land(&directory.join(format!("release-tracks-{release}.json")), &answer)?;
        let tracks = tracks_of(&answer);
        for (title, track) in match_tracks(&tracks, &remaining) {
            let plays = wanted.iter().find(|(wanted, _)| *wanted == title).map_or(0, |(_, plays)| *plays);
            let recording = Found {
                recording_mbid: track.recording_mbid.clone().unwrap_or_default(),
                artist_mbid: None,
                release_mbid: Some(release.clone()),
                title: track.title.clone(),
                artist_credit: track.artist_credit.clone().unwrap_or_default(),
                credited: Vec::new(),
                score: 100,
            };
            summary.listens += apply(db, &Pair { artist: artist.to_string(), track: title.clone(), plays }, &recording)?;
            remaining.retain(|left| *left != title);
        }
        if remaining.is_empty() {
            break;
        }
    }
    let outcome = if remaining.len() == titles.len() {
        "missing"
    } else if remaining.is_empty() {
        "matched"
    } else {
        "partial"
    };
    match outcome {
        "matched" => summary.matched += 1,
        "partial" => summary.partial += 1,
        _ => summary.missing += 1,
    }
    record(db, artist, album, outcome)
}

pub fn run(db: &SqliteClient, limit: usize) -> Result<()> {
    let retry_before = chrono::Utc::now().timestamp() - RETRY_AFTER_DAYS * 86_400;
    let albums: Vec<(String, String)> = db
        .query(SQL_PENDING, &[json!(retry_before), json!(limit)])?
        .iter()
        .filter_map(|row| Some((row["artist_name"].as_str()?.to_string(), row["release_name"].as_str()?.to_string())))
        .collect();
    println!("{} albums to look up, two or three requests each", albums.len());
    let client = crate::listenbrainz::http_client()?;
    let directory = landing("musicbrainz")?;
    let mut summary = Summary::default();
    for (artist, album) in &albums {
        resolve_album(db, &client, &directory, artist, album, &mut summary).with_context(|| format!("looking up {artist} - {album}"))?;
    }
    db.execute(SQL_RESET_ENRICH_CURSOR, &[])?;
    println!("{} albums fully matched, {} partly, {} not found; {} listens got an id", summary.matched, summary.partial, summary.missing, summary.listens);
    println!("next: enrich, then daily-plays all, all-time-totals, summaries all, memories, capsules, entities");
    Ok(())
}

pub fn job() -> Job<SqliteClient> {
    Job::new("resolve-albums", "give ids to unmapped listens by finding their album at MusicBrainz (cleaned of editions) and reading its tracklist, for at most <limit> albums", |db, args| {
        run(db, args.positional(0).parse().context("the limit must be a number")?)
    })
    .takes(&["limit"])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release(id: &str, title: &str, score: i64, date: &str, status: &str, tracks: i64) -> Value {
        json!({"id": id, "title": title, "score": score, "date": date, "status": status, "track-count": tracks, "artist-credit": [{"name": "Madonna"}]})
    }

    #[test]
    fn the_cleaned_title_finds_the_release_whatever_the_edition_called_it() {
        let answer = json!({"releases": [release("a", "Hard Candy", 100, "2008-04-25", "Official", 12)]});
        assert_eq!(candidate_releases(&answer, "Madonna", "Hard Candy (Deluxe Version)", None), vec!["a".to_string()]);
        assert_eq!(candidate_releases(&answer, "Madonna", "Hard Candy - Single", None), vec!["a".to_string()]);
    }

    #[test]
    fn the_year_of_the_library_picks_among_the_editions() {
        let answer = json!({"releases": [
            release("later", "Hard Candy", 100, "2018-01-01", "Official", 17),
            release("first", "Hard Candy", 100, "2008-04-25", "Official", 12),
        ]});
        assert_eq!(candidate_releases(&answer, "Madonna", "Hard Candy", Some(2008)), vec!["first".to_string(), "later".to_string()]);
        assert_eq!(candidate_releases(&answer, "Madonna", "Hard Candy", None), vec!["later".to_string(), "first".to_string()], "with no year, the fullest release first");
    }

    #[test]
    fn a_weak_score_a_wrong_title_or_another_artist_is_no_match() {
        let other_artist = json!({"id": "x", "title": "Hard Candy", "score": 100, "artist-credit": [{"name": "Someone Else"}]});
        let answer = json!({"releases": [release("weak", "Hard Candy", 80, "2008", "Official", 12), release("other", "Music", 100, "2000", "Official", 12), other_artist]});
        assert_eq!(candidate_releases(&answer, "Madonna", "Hard Candy", None), Vec::<String>::new());
    }

    #[test]
    fn a_collaboration_is_the_artists_when_any_of_them_is_credited() {
        let answer = json!({"releases": [release("a", "Cry", 100, "2020", "Official", 1)]});
        assert_eq!(candidate_releases(&answer, "Madonna, Someone Else", "Cry (feat. Grimes)", None), vec!["a".to_string()]);
        assert_eq!(artist_parts("TIX, Kulturaften & Krobbe"), vec!["TIX, Kulturaften & Krobbe", "TIX", "Kulturaften", "Krobbe"]);
    }

    #[test]
    fn a_live_or_guest_version_is_matched_by_its_core_title_inside_the_album() {
        let track = |title: &str| TrackRow { disc: 1, position: 1, title: title.into(), recording_mbid: Some("r".into()), length_ms: None, artist_credit: None };
        let tracks = [track("Hello"), track("Romeo")];
        let wanted = ["Hello - Live".to_string(), "Romeo + Ravyn Lenae".to_string(), "Other - Live".to_string()];
        let matched: Vec<String> = match_tracks(&tracks, &wanted).into_iter().map(|(title, _)| title).collect();
        assert_eq!(matched, vec!["Hello - Live".to_string(), "Romeo + Ravyn Lenae".to_string()]);
    }

    #[test]
    fn a_track_is_matched_by_title_across_remaster_and_guest_tails() {
        let track = |title: &str, recording: Option<&str>| TrackRow { disc: 1, position: 1, title: title.into(), recording_mbid: recording.map(str::to_string), length_ms: None, artist_credit: None };
        let tracks = [track("Candy Shop", Some("r1")), track("Heartbeat (2018 Remaster)", Some("r2")), track("No Id", None)];
        let wanted = ["candy shop".to_string(), "Heartbeat".to_string(), "No Id".to_string(), "Missing".to_string()];
        let matched: Vec<_> = match_tracks(&tracks, &wanted).into_iter().map(|(title, track)| (title, track.recording_mbid.clone())).collect();
        assert_eq!(matched, vec![("candy shop".to_string(), Some("r1".to_string())), ("Heartbeat".to_string(), Some("r2".to_string()))]);
    }
}
