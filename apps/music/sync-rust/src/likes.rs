//! Keeps the loves of Last.fm and the saved tracks of Spotify equal, in one direction at a time and only by adding:
//! what is loved on one side and absent on the other is added there, and nothing is ever removed. Songs are the same
//! song when `loose_key` says so (the artist and title as `song_key` folds them, collaborations and featured guests allowed for). A song that was pushed once, or that Spotify could not find, is not tried again,
//! so a like taken back on the other side stays taken back. `likes-ignore` keeps a song out in both directions.

use std::collections::{HashMap, HashSet};

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use shared_data::batch::insert_statements;
use shared_data::job::{Args, Job};
use shared_data::sqlite_client::SqliteClient;

use crate::artist_alias::{AliasLine, Aliases};
use crate::names::{lead, title_key};
use crate::song_key::artist_key;

const DEFAULT_LIMIT: usize = 50;
const SPOTIFY_BATCH: usize = 40;
const SQL_LOVED: &str = "SELECT artist_name, track_name, loved_at AS at FROM lastfm_loved";
const SQL_ALIASES: &str = "SELECT alias_name, canonical_name FROM artist_alias";
const SQL_SAVED: &str = "SELECT artist_name, track_name, added_at AS at FROM spotify_saved";
const SQL_IGNORED: &str = "SELECT song_key FROM like_ignore";
const SQL_DONE: &str = "SELECT song_key, target FROM like_pushed UNION SELECT song_key, target FROM like_unmatched";
const SQL_PUSHED_ONLY: &str = "SELECT song_key, target FROM like_pushed";
const SQL_PUSHED: &str = "INSERT OR REPLACE INTO like_pushed (song_key, target, pushed_at) VALUES (?, ?, ?)";
const SQL_UNMATCHED: &str = "INSERT OR REPLACE INTO like_unmatched (song_key, target, tried_at) VALUES (?, ?, ?)";
const SQL_IGNORE: &str = "INSERT OR REPLACE INTO like_ignore (song_key, artist_name, track_name, created_at) VALUES (?, ?, ?, ?)";
const SQL_UNIGNORE: &str = "DELETE FROM like_ignore WHERE song_key = ?";
const SQL_LIST_IGNORED: &str = "SELECT artist_name, track_name FROM like_ignore ORDER BY created_at DESC";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Target {
    Spotify,
    Lastfm,
}

impl Target {
    fn name(self) -> &'static str {
        match self {
            Self::Spotify => "spotify",
            Self::Lastfm => "lastfm",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Song {
    /// As the list spells it: Last.fm's one string, or Spotify's artists joined with " & ".
    pub artist: String,
    /// Spotify's artists one by one; Last.fm's single string for a song from Last.fm.
    pub credits: Vec<String>,
    pub track: String,
    /// When it was loved or saved, to push the newest first.
    pub at: i64,
}

/// What two lists' spellings of a song share: the artist and the title as `song_key` folds them, with "and" left out of the artist
/// (Last.fm writes "A, B & C" where Spotify's list joins to "A & B & C") and a featured guest left off the title.
fn loose_key(artist: &str, track: &str) -> String {
    format!("{}\u{1f}{}", credit_text(&artist_key(artist)), plain_title(track))
}

impl Song {
    fn loved(artist: &str, track: &str, at: i64) -> Self {
        Self { artist: artist.into(), credits: vec![artist.into()], track: track.into(), at }
    }

    fn saved(credits: Vec<String>, track: &str, at: i64) -> Self {
        Self { artist: credits.join(" & "), credits, track: track.into(), at }
    }

    fn key(&self) -> String {
        loose_key(&self.artist, &self.track)
    }
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Plan {
    /// Songs on each side, one per key: an empty side means its sync has not run, and then everything on the other looks missing.
    pub loved: usize,
    pub saved: usize,
    pub to_spotify: Vec<Song>,
    pub to_lastfm: Vec<Song>,
    pub in_both: usize,
    pub ignored: usize,
    /// Pending, but pushed or not found before, so left alone.
    pub tried: usize,
}

/// One song per key (the newest spelling kept), newest first.
fn by_key(songs: &[Song]) -> Vec<(String, &Song)> {
    let mut seen = HashSet::new();
    let mut sorted: Vec<&Song> = songs.iter().collect();
    sorted.sort_by_key(|song| std::cmp::Reverse(song.at));
    sorted.into_iter().map(|song| (song.key(), song)).filter(|(key, _)| seen.insert(key.clone())).collect()
}

/// Songs by their title without a featured guest, to look for the other list's song among few.
fn by_title<'a>(songs: &'a [(String, &'a Song)]) -> HashMap<String, Vec<&'a Song>> {
    let mut index: HashMap<String, Vec<&Song>> = HashMap::new();
    for (_, song) in songs {
        index.entry(plain_title(&song.track)).or_default().push(song);
    }
    index
}

/// The title without a featured guest: "Talk Talk featuring Troye Sivan" and "Talk Talk (feat. Troye Sivan)" are "Talk Talk".
/// Any other tail (a remix, a live version) stays, and is another song.
fn plain_title(track: &str) -> String {
    title_key(lead(track))
}

/// The loved song and the saved one are the same song: the title, and the artist as one of Spotify's or as the first few run together.
fn same_song(loved: &Song, saved: &Song) -> bool {
    plain_title(&loved.track) == plain_title(&saved.track) && credit_matches(&loved.artist, &saved.credits)
}

pub fn plan(loved: &[Song], saved: &[Song], ignored: &HashSet<String>, done: &HashSet<(String, Target)>) -> Plan {
    let (loved, saved) = (by_key(loved), by_key(saved));
    let (loved_titles, saved_titles) = (by_title(&loved), by_title(&saved));
    let loved_has_match = |song: &Song| saved_titles.get(&plain_title(&song.track)).is_some_and(|found| found.iter().any(|other| same_song(song, other)));
    let saved_has_match = |song: &Song| loved_titles.get(&plain_title(&song.track)).is_some_and(|found| found.iter().any(|other| same_song(other, song)));
    let mut plan = Plan { loved: loved.len(), saved: saved.len(), in_both: loved.iter().filter(|(_, song)| loved_has_match(song)).count(), ..Plan::default() };
    let mut pending = |songs: &[(String, &Song)], matched: &dyn Fn(&Song) -> bool, target: Target, into: fn(&mut Plan) -> &mut Vec<Song>| {
        for (key, song) in songs.iter().filter(|(_, song)| !matched(song)) {
            if ignored.contains(key) {
                plan.ignored += 1;
            } else if done.contains(&(key.clone(), target)) {
                plan.tried += 1;
            } else {
                into(&mut plan).push((*song).clone());
            }
        }
    };
    pending(&loved, &loved_has_match, Target::Spotify, |plan| &mut plan.to_spotify);
    pending(&saved, &saved_has_match, Target::Lastfm, |plan| &mut plan.to_lastfm);
    plan
}

/// A track Spotify's search found.
#[derive(Debug, PartialEq, Eq)]
pub struct Candidate {
    pub uri: String,
    pub name: String,
    pub artists: Vec<String>,
}

pub fn candidates(search: &str) -> Result<Vec<Candidate>> {
    let answer: Value = serde_json::from_str(search).context("reading a Spotify search")?;
    Ok(answer["tracks"]["items"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    Some(Candidate {
                        uri: item["uri"].as_str()?.to_string(),
                        name: item["name"].as_str()?.to_string(),
                        artists: item["artists"].as_array()?.iter().filter_map(|artist| artist["name"].as_str().map(str::to_string)).collect(),
                    })
                })
                .collect()
        })
        .unwrap_or_default())
}

/// "and" is dropped from both sides, so "Dua Lipa & Young Thug" and "Dua Lipa, Young Thug" are the same credit.
fn credit_text(key: &str) -> String {
    key.replace("and", "")
}

/// Whether Last.fm's artist is Spotify's artists: any one of them, or the first few run together in order, because Last.fm
/// has one string for a collaboration ("Bad Bunny & Tainy") where Spotify has a list.
fn credit_matches(wanted: &str, artists: &[String]) -> bool {
    let wanted = artist_key(wanted);
    let keys: Vec<String> = artists.iter().map(|artist| artist_key(artist)).collect();
    keys.contains(&wanted) || (1..=keys.len()).any(|count| credit_text(&keys[..count].concat()) == credit_text(&wanted))
}

/// The uri of the first result that is the wanted song: its title and its artists, never a near miss.
#[must_use]
pub fn pick<'a>(wanted: &Song, found: &'a [Candidate]) -> Option<&'a str> {
    found.iter().find(|candidate| plain_title(&wanted.track) == plain_title(&candidate.name) && credit_matches(&wanted.artist, &candidate.artists)).map(|candidate| candidate.uri.as_str())
}

fn load(db: &SqliteClient, sql: &str) -> Result<Vec<Value>> {
    db.query(sql, &[]).with_context(|| format!("reading {sql}"))
}

/// The rows of a list as songs, a renamed artist under its new name (Last.fm may hold the old one); Spotify's artists are kept one by one, joined with the unit separator in `spotify_saved`.
fn songs(rows: &[Value], spotify: bool, aliases: &Aliases) -> Vec<Song> {
    rows.iter()
        .filter_map(|row| {
            let (artist, track, at) = (row["artist_name"].as_str()?, row["track_name"].as_str()?, row["at"].as_i64().unwrap_or(0));
            Some(if spotify { Song::saved(artist.split('\u{1f}').map(|name| aliases.canonical(name).to_string()).collect(), track, at) } else { Song::loved(aliases.canonical(artist), track, at) })
        })
        .collect()
}

fn current(db: &SqliteClient, retry_unmatched: bool) -> Result<Plan> {
    let ignored = load(db, SQL_IGNORED)?.iter().filter_map(|row| row["song_key"].as_str().map(str::to_string)).collect();
    let done = load(db, if retry_unmatched { SQL_PUSHED_ONLY } else { SQL_DONE })?
        .iter()
        .filter_map(|row| {
            let target = match row["target"].as_str()? {
                "spotify" => Target::Spotify,
                "lastfm" => Target::Lastfm,
                _ => return None,
            };
            Some((row["song_key"].as_str()?.to_string(), target))
        })
        .collect();
    let lines: Vec<AliasLine> = load(db, SQL_ALIASES)?.iter().filter_map(|row| Some(AliasLine { alias: row["alias_name"].as_str()?.to_string(), canonical: row["canonical_name"].as_str()?.to_string() })).collect();
    let aliases = Aliases::new(&lines);
    Ok(plan(&songs(&load(db, SQL_LOVED)?, false, &aliases), &songs(&load(db, SQL_SAVED)?, true, &aliases), &ignored, &done))
}

fn describe(songs: &[Song]) -> String {
    songs.iter().fold(String::new(), |text, song| text + &format!("  {} - {}\n", song.artist, song.track))
}

fn status(db: &SqliteClient, _: &Args) -> Result<()> {
    let plan = current(db, false)?;
    println!(
        "in both: {}\nto save on Spotify: {}\nto love on Last.fm: {}\nignored: {}\nalready tried (pushed or not found): {}",
        plan.in_both,
        plan.to_spotify.len(),
        plan.to_lastfm.len(),
        plan.ignored,
        plan.tried
    );
    Ok(())
}

fn show_plan(db: &SqliteClient, _: &Args) -> Result<()> {
    let plan = current(db, false)?;
    println!("To save on Spotify ({}):\n{}\nTo love on Last.fm ({}):\n{}", plan.to_spotify.len(), describe(&plan.to_spotify), plan.to_lastfm.len(), describe(&plan.to_lastfm));
    Ok(())
}

fn record(db: &SqliteClient, sql: &str, song: &Song, target: Target) -> Result<()> {
    db.execute(sql, &[json!(song.key()), json!(target.name()), json!(chrono::Utc::now().timestamp())])
}

fn search(http: &reqwest::blocking::Client, token: &str, query: &str) -> Result<Vec<Candidate>> {
    let url = reqwest::Url::parse_with_params(&format!("{}/search", crate::spotify_api::API), &[("q", query), ("type", "track"), ("limit", "10")]).context("building a Spotify search")?;
    candidates(&crate::spotify_api::send(http, token, &reqwest::Method::GET, url.as_str())?)
}

/// What Spotify has under the song: a field search first, then the plain words.
fn find(http: &reqwest::blocking::Client, token: &str, song: &Song) -> Result<Option<String>> {
    for query in [format!("track:{} artist:{}", song.track, song.artist), format!("{} {}", song.artist, song.track)] {
        if let Some(uri) = pick(song, &search(http, token, &query)?) {
            return Ok(Some(uri.to_string()));
        }
    }
    Ok(None)
}

fn push_to_spotify(db: &SqliteClient, songs: &[Song], dry_run: bool) -> Result<()> {
    let (http, mut found) = (crate::spotify_api::client()?, Vec::new());
    let token = crate::spotify_api::access_token(&http)?;
    for song in songs {
        match find(&http, &token, song)? {
            Some(uri) => found.push((song, uri)),
            None if dry_run => println!("not on Spotify: {} - {}", song.artist, song.track),
            None => record(db, SQL_UNMATCHED, song, Target::Spotify)?,
        }
    }
    for batch in found.chunks(SPOTIFY_BATCH) {
        if dry_run {
            for (song, _) in batch {
                println!("would save on Spotify: {} - {}", song.artist, song.track);
            }
            continue;
        }
        let uris = batch.iter().map(|(_, uri)| uri.as_str()).collect::<Vec<_>>().join(",");
        let url = reqwest::Url::parse_with_params(&format!("{}/me/library", crate::spotify_api::API), &[("uris", uris.as_str())]).context("building the save request")?;
        crate::spotify_api::send(&http, &token, &reqwest::Method::PUT, url.as_str())?;
        for (song, _) in batch {
            record(db, SQL_PUSHED, song, Target::Spotify)?;
        }
    }
    println!("Spotify: {} {}, {} not found", found.len(), if dry_run { "would be saved" } else { "saved" }, songs.len() - found.len());
    Ok(())
}

fn push_to_lastfm(db: &SqliteClient, songs: &[Song], dry_run: bool) -> Result<()> {
    let http = crate::listenbrainz::http_client()?;
    let session = if dry_run { String::new() } else { crate::lastfm_love::session_key()? };
    for song in songs {
        if dry_run {
            println!("would love on Last.fm: {} - {}", song.artist, song.track);
        } else {
            crate::lastfm_love::love(&http, &session, song.credits.first().unwrap_or(&song.artist), &song.track)?;
            record(db, SQL_PUSHED, song, Target::Lastfm)?;
        }
    }
    println!("Last.fm: {} {}", songs.len(), if dry_run { "would be loved" } else { "loved" });
    Ok(())
}

fn push(db: &SqliteClient, args: &Args) -> Result<()> {
    let limit = Some(args.positional(0)).filter(|value| !value.is_empty()).map_or(Ok(DEFAULT_LIMIT), |value| value.parse().context("the limit must be a number"))?;
    let (plan, dry_run) = (current(db, args.flag("--retry-unmatched"))?, args.flag("--dry-run"));
    if plan.loved == 0 || plan.saved == 0 {
        bail!("one list is empty: run `feedback` and `spotify-likes` first, or everything on the other side would be added");
    }
    let (only_spotify, only_lastfm) = (args.flag("--only-spotify"), args.flag("--only-lastfm"));
    if !only_spotify {
        push_to_lastfm(db, &plan.to_lastfm[..plan.to_lastfm.len().min(limit)], dry_run)?;
    }
    if !only_lastfm {
        push_to_spotify(db, &plan.to_spotify[..plan.to_spotify.len().min(limit)], dry_run)?;
    }
    Ok(())
}

fn add_ignore(db: &SqliteClient, artist: &str, track: &str) -> Result<()> {
    if artist.is_empty() || track.is_empty() {
        bail!("name the artist and the track");
    }
    db.execute(SQL_IGNORE, &[json!(loose_key(artist, track)), json!(artist), json!(track), json!(chrono::Utc::now().timestamp())])
}

fn ignore(db: &SqliteClient, args: &Args) -> Result<()> {
    add_ignore(db, args.positional(0), args.positional(1))?;
    println!("ignored: {} - {}", args.positional(0), args.positional(1));
    Ok(())
}

fn unignore(db: &SqliteClient, args: &Args) -> Result<()> {
    db.execute(SQL_UNIGNORE, &[json!(loose_key(args.positional(0), args.positional(1)))])?;
    println!("no longer ignored: {} - {}", args.positional(0), args.positional(1));
    Ok(())
}

fn ignored(db: &SqliteClient, _: &Args) -> Result<()> {
    for row in load(db, SQL_LIST_IGNORED)? {
        println!("{} - {}", row["artist_name"].as_str().unwrap_or(""), row["track_name"].as_str().unwrap_or(""));
    }
    Ok(())
}

/// What the loved side replaces on every `feedback` run: every love, with or without a MusicBrainz id.
pub fn replace_loved(db: &SqliteClient, loved: &[crate::feedback::Loved]) -> Result<()> {
    let mut batch = vec![("DELETE FROM lastfm_loved".to_string(), Vec::new())];
    let rows = loved.iter().map(|love| vec![json!(love.artist), json!(love.track), json!(love.at)]);
    batch.extend(insert_statements("INSERT OR REPLACE INTO", "lastfm_loved", &["artist_name", "track_name", "loved_at"], rows));
    db.execute_batch(&batch).context("replacing the loved tracks")
}

/// The jobs that keep the two lists equal, which `main` adds to its own.
#[must_use]
pub fn jobs() -> Vec<Job<SqliteClient>> {
    vec![
        Job::new("likes-status", "how many likes are in both lists and how many wait to be added each way", status),
        Job::new("likes-plan", "list what likes-push would add to Spotify and to Last.fm, changing nothing", show_plan),
        Job::new("likes-push", "add the missing likes on each side, at most <limit> per side (default 50)", push).takes(&["limit"]).flags(&["--dry-run", "--only-spotify", "--only-lastfm", "--retry-unmatched"]),
        Job::new("likes-ignore", "keep a song out of the sync both ways: <artist> <track>", ignore).takes(&["artist", "track"]),
        Job::new("likes-unignore", "let a song into the sync again: <artist> <track>", unignore).takes(&["artist", "track"]),
        Job::new("likes-ignored", "list the songs kept out of the sync", ignored),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn song(artist: &str, track: &str, at: i64) -> Song {
        Song::loved(artist, track, at)
    }

    fn saved(artists: &[&str], track: &str, at: i64) -> Song {
        Song::saved(artists.iter().map(|artist| (*artist).to_string()).collect(), track, at)
    }

    fn candidate(name: &str, artists: &[&str]) -> Candidate {
        Candidate { uri: format!("spotify:track:{name}"), name: name.into(), artists: artists.iter().map(|artist| (*artist).to_string()).collect() }
    }

    #[test]
    fn each_side_gets_what_the_other_has_newest_first_and_spellings_that_share_a_key_are_one_song() {
        let loved = [song("Charli XCX", "Von dutch", 5), song("PinkPantheress", "Nice to know you", 9), song("Charli xcx", "Von Dutch", 1)];
        let saved = [song("Charli XCX", "Von Dutch (Remastered 2024)", 3), song("Röyksopp", "Eple", 7), song("Robyn", "Dancing on my own", 8)];
        let plan = plan(&loved, &saved, &HashSet::new(), &HashSet::new());
        assert_eq!(plan.in_both, 1);
        assert_eq!(plan.to_spotify.iter().map(|song| song.track.as_str()).collect::<Vec<_>>(), ["Nice to know you"]);
        assert_eq!(plan.to_lastfm.iter().map(|song| song.track.as_str()).collect::<Vec<_>>(), ["Dancing on my own", "Eple"]);
    }

    #[test]
    fn a_collaboration_is_one_song_however_the_two_lists_write_the_credit() {
        let loved = [song("Calvin Harris, Dua Lipa & Young Thug", "Potion", 1), song("Bad Bunny & Tainy", "Callaita", 3), song("Charli XCX", "Von Dutch featuring Someone", 2), song("Charli XCX", "Talk Talk", 4)];
        let saved = [
            saved(&["Calvin Harris", "Dua Lipa", "Young Thug"], "Potion", 1),
            saved(&["Bad Bunny", "Tainy"], "Callaita", 3),
            saved(&["Charli XCX", "A. G. Cook"], "Von Dutch", 2),
            saved(&["Charli XCX", "Troye Sivan"], "Talk Talk", 4),
            saved(&["Tainy"], "Callaita", 5),
        ];
        let plan = plan(&loved, &saved, &HashSet::new(), &HashSet::new());
        assert_eq!((plan.in_both, plan.to_spotify.len()), (4, 0));
        assert_eq!(plan.to_lastfm.iter().map(|song| song.artist.as_str()).collect::<Vec<_>>(), ["Tainy"]);
    }

    #[test]
    fn an_ignored_or_already_tried_song_is_left_out_of_the_direction_it_was_tried_in_only() {
        let loved = [song("A", "One", 3), song("A", "Two", 2), song("A", "Three", 1)];
        let ignored = HashSet::from([loose_key("A", "One")]);
        let done = HashSet::from([(loose_key("A", "Two"), Target::Spotify), (loose_key("A", "Three"), Target::Lastfm)]);
        let plan = plan(&loved, &[], &ignored, &done);
        assert_eq!((plan.ignored, plan.tried), (1, 1));
        assert_eq!(plan.to_spotify.iter().map(|song| song.track.as_str()).collect::<Vec<_>>(), ["Three"]);
    }

    fn database() -> SqliteClient {
        let db = SqliteClient::open(std::path::Path::new(":memory:")).unwrap();
        crate::schema::apply(&db).unwrap();
        db
    }

    #[test]
    fn the_plan_is_read_from_the_tables_and_leaves_out_what_was_ignored_pushed_or_not_found() {
        let db = database();
        let loved = |artist: &str, track: &str| crate::feedback::Loved { artist: artist.into(), track: track.into(), recording_mbid: None, at: 1 };
        replace_loved(&db, &[loved("A", "One"), loved("A", "Two"), loved("A", "Three"), loved("A", "Four")]).unwrap();
        replace_loved(&db, &[loved("A", "One"), loved("A", "Two"), loved("A", "Three"), loved("A", "Four")]).unwrap();
        db.execute("INSERT INTO spotify_saved (spotify_id, track_name, artist_name, added_at) VALUES ('s1', 'Five', 'B', 2)", &[]).unwrap();
        add_ignore(&db, "A", "One").unwrap();
        record(&db, SQL_PUSHED, &song("A", "Two", 0), Target::Spotify).unwrap();
        record(&db, SQL_UNMATCHED, &song("A", "Three", 0), Target::Spotify).unwrap();
        let plan = current(&db, false).unwrap();
        assert_eq!(plan.to_spotify.iter().map(|song| song.track.as_str()).collect::<Vec<_>>(), ["Four"]);
        assert_eq!(plan.to_lastfm.iter().map(|song| song.track.as_str()).collect::<Vec<_>>(), ["Five"]);
        assert_eq!((plan.loved, plan.saved, plan.ignored, plan.tried), (4, 1, 1, 2));
        db.execute(SQL_UNIGNORE, &[json!(loose_key("A", "One"))]).unwrap();
        assert_eq!(current(&db, false).unwrap().to_spotify.len(), 2);
    }

    #[test]
    fn a_search_result_is_taken_only_when_it_is_the_song_itself() {
        let wanted = song("Charli XCX", "Von dutch", 0);
        let found = [candidate("Von Dutch (A. G. Cook Remix)", &["Charli XCX"]), candidate("Von Dutch", &["Someone Else"]), candidate("Von dutch - Remastered 2024", &["A. G. Cook", "Charli XCX"])];
        assert_eq!(pick(&wanted, &found), Some("spotify:track:Von dutch - Remastered 2024"));
        assert_eq!(pick(&wanted, &found[..2]), None);
    }

    #[test]
    fn a_collaboration_is_the_list_of_artists_and_a_featured_guest_in_the_title_is_not_another_song() {
        let found = |name: &str, artists: &[&str]| vec![candidate(name, artists)];
        let wanted = |artist: &str, track: &str| song(artist, track, 0);
        assert!(pick(&wanted("Bad Bunny & Tainy", "Callaita"), &found("Callaita", &["Bad Bunny", "Tainy"])).is_some());
        assert!(pick(&wanted("Calvin Harris, Dua Lipa & Young Thug", "Potion"), &found("Potion", &["Calvin Harris", "Dua Lipa", "Young Thug"])).is_some());
        assert!(pick(&wanted("Charli XCX", "Talk Talk featuring Troye Sivan"), &found("Talk Talk", &["Charli XCX", "Troye Sivan"])).is_some());
        assert!(pick(&wanted("Bad Bunny & Tainy", "Callaita"), &found("Callaita", &["Bad Bunny"])).is_none());
        assert!(pick(&wanted("Bad Bunny & Tainy", "Callaita"), &found("Callaita", &["Tainy", "Someone Else"])).is_none());
        assert!(pick(&wanted("Love", "Love Without You"), &found("Love", &["Love"])).is_none());
        assert!(pick(&wanted("Beyoncé & Madonna", "Break My Soul (The Queens Remix)"), &found("Break My Soul", &["Beyoncé", "Madonna"])).is_none());
    }

    #[test]
    fn a_search_answer_is_read_and_an_empty_one_has_no_candidates() {
        let answer = json!({ "tracks": { "items": [{ "uri": "spotify:track:1", "name": "Song", "artists": [{ "name": "A" }] }] } }).to_string();
        assert_eq!(candidates(&answer).unwrap(), [Candidate { uri: "spotify:track:1".into(), name: "Song".into(), artists: vec!["A".into()] }]);
        assert!(candidates("{}").unwrap().is_empty());
    }

    #[test]
    fn a_song_loved_under_the_old_name_of_a_renamed_artist_is_the_one_saved_under_the_new() {
        let aliases = Aliases::new(&[AliasLine { alias: "Marina and the Diamonds".into(), canonical: "MARINA".into() }]);
        let loved = songs(&[json!({"artist_name": "Marina and the Diamonds", "track_name": "Primadonna", "at": 1})], false, &aliases);
        let saved = songs(&[json!({"artist_name": "MARINA", "track_name": "Primadonna", "at": 2})], true, &aliases);
        let plan = plan(&loved, &saved, &HashSet::new(), &HashSet::new());
        assert_eq!((plan.in_both, plan.to_spotify.len(), plan.to_lastfm.len()), (1, 0, 0));
    }
}
