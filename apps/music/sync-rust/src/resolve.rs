//! Gives a MusicBrainz id to the listens that have none, by looking the (artist, track)
//! pair up by name. A pair is asked once per source and again after a quarter of a year: what matched is written onto every
//! unmapped play of the pair, and what did not is remembered in `resolve_attempts`.

use std::time::Duration;

use anyhow::{bail, Context, Result};
use serde::Deserialize;
use serde_json::json;
use shared_data::sqlite_client::SqliteClient;

use crate::names::{same_artist, same_title};

/// MusicBrainz' own match score, 0-100; below this a candidate is a guess. It is lower than it looks because `accept` also
/// wants the same title and the same artist: a «feat.» credit alone drops an exact match to the 80s.
const MIN_SCORE: i64 = 60;
/// A pair that was not matched is asked again after this long, because MusicBrainz gets new recordings.
const RETRY_AFTER_DAYS: i64 = 90;
/// MusicBrainz allows one request per second per IP.
const MUSICBRAINZ_PAUSE: Duration = Duration::from_millis(1100);
const MUSICBRAINZ_RETRY_PAUSE: Duration = Duration::from_secs(10);
const MUSICBRAINZ_ATTEMPTS: u32 = 5;
const CANDIDATES_PER_SEARCH: &str = "10";

const SQL_PENDING: &str = "SELECT artist_name, track_name, COUNT(*) AS plays FROM listens \
    WHERE recording_mbid IS NULL \
      AND NOT EXISTS (SELECT 1 FROM resolve_attempts a WHERE a.artist_name = listens.artist_name \
                      AND a.track_name = listens.track_name AND a.source = ? AND a.tried_at > ?) \
    GROUP BY artist_name, track_name ORDER BY plays DESC, artist_name, track_name LIMIT ?";
const SQL_APPLY: &str = "UPDATE listens SET recording_mbid = ?, artist_mbid = COALESCE(artist_mbid, ?), release_mbid = COALESCE(release_mbid, ?) \
    WHERE recording_mbid IS NULL AND artist_name = ? AND track_name = ?";
const SQL_CHANGES: &str = "SELECT changes() AS n";
const SQL_RECORD: &str = "INSERT OR REPLACE INTO resolve_attempts (artist_name, track_name, source, outcome, tried_at) VALUES (?, ?, ?, ?, ?)";
// The metadata job asks only for recordings it has no row for, so starting over at 0 asks for just the new ones.
pub(crate) const SQL_RESET_ENRICH_CURSOR: &str = "UPDATE enrich_state SET last_listen_rowid = 0 WHERE id = 1";

#[derive(Debug, Clone)]
pub struct Pair {
    pub artist: String,
    pub track: String,
    pub plays: i64,
}

#[derive(Debug, Clone)]
pub struct Found {
    pub recording_mbid: String,
    pub artist_mbid: Option<String>,
    pub release_mbid: Option<String>,
    pub title: String,
    pub artist_credit: String,
    /// Each credited artist on its own, for a collaboration the listened name is only one of.
    pub credited: Vec<String>,
    pub score: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Matched,
    Rejected,
    Missing,
}

impl Outcome {
    fn as_str(self) -> &'static str {
        match self {
            Outcome::Matched => "matched",
            Outcome::Rejected => "rejected",
            Outcome::Missing => "missing",
        }
    }
}

/// The unmapped pairs `source` has not tried in the last `RETRY_AFTER_DAYS`, most played first.
pub fn pending_pairs(db: &SqliteClient, source: &str, limit: usize) -> Result<Vec<Pair>> {
    let retry_before = chrono::Utc::now().timestamp() - RETRY_AFTER_DAYS * 86_400;
    let rows = db.query(SQL_PENDING, &[json!(source), json!(retry_before), json!(limit)])?;
    Ok(rows
        .iter()
        .filter_map(|row| Some(Pair { artist: row["artist_name"].as_str()?.to_string(), track: row["track_name"].as_str()?.to_string(), plays: row["plays"].as_i64()? }))
        .collect())
}

pub fn accept(pair: &Pair, found: &Found) -> bool {
    let artist = same_artist(&pair.artist, &found.artist_credit) || found.credited.iter().any(|name| same_artist(&pair.artist, name));
    artist && same_title(&pair.track, &found.title)
}

/// The first candidate that scores well and passes `accept`, and why there was none.
pub fn choose<'a>(pair: &Pair, candidates: &'a [Found]) -> (Outcome, Option<&'a Found>) {
    if candidates.is_empty() {
        return (Outcome::Missing, None);
    }
    match candidates.iter().find(|found| found.score >= MIN_SCORE && accept(pair, found)) {
        Some(found) => (Outcome::Matched, Some(found)),
        None => (Outcome::Rejected, None),
    }
}

/// Writes the ids onto every unmapped listen of the pair and returns how many it changed.
pub fn apply(db: &SqliteClient, pair: &Pair, found: &Found) -> Result<usize> {
    db.execute(SQL_APPLY, &[json!(found.recording_mbid), json!(found.artist_mbid), json!(found.release_mbid), json!(pair.artist), json!(pair.track)])?;
    let changed = db.query(SQL_CHANGES, &[])?.first().and_then(|row| row["n"].as_u64()).unwrap_or(0);
    Ok(usize::try_from(changed)?)
}

pub fn record(db: &SqliteClient, pair: &Pair, source: &str, outcome: Outcome) -> Result<()> {
    db.execute(SQL_RECORD, &[json!(pair.artist), json!(pair.track), json!(source), json!(outcome.as_str()), json!(chrono::Utc::now().timestamp())])
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Summary {
    pub matched: usize,
    pub rejected: usize,
    pub missing: usize,
    pub listens_updated: usize,
}

/// Looks each pair up, writes what matched and remembers what did not.
pub fn resolve_with(db: &SqliteClient, source: &str, pairs: &[Pair], mut lookup: impl FnMut(&Pair) -> Result<Vec<Found>>) -> Result<Summary> {
    let mut summary = Summary::default();
    for pair in pairs {
        let candidates = lookup(pair).with_context(|| format!("looking up {} - {}", pair.artist, pair.track))?;
        let (outcome, chosen) = choose(pair, &candidates);
        if let Some(found) = chosen {
            summary.listens_updated += apply(db, pair, found)?;
        }
        match outcome {
            Outcome::Matched => summary.matched += 1,
            Outcome::Rejected => summary.rejected += 1,
            Outcome::Missing => summary.missing += 1,
        }
        record(db, pair, source, outcome)?;
    }
    Ok(summary)
}

#[derive(Deserialize)]
struct Search {
    #[serde(default)]
    recordings: Vec<SearchRecording>,
}

#[derive(Deserialize)]
struct SearchRecording {
    id: String,
    title: String,
    #[serde(default)]
    score: i64,
    #[serde(rename = "artist-credit", default)]
    artist_credit: Vec<Credit>,
    #[serde(default)]
    releases: Vec<Release>,
}

#[derive(Deserialize)]
struct Credit {
    name: String,
    joinphrase: Option<String>,
    artist: Option<CreditedArtist>,
}

#[derive(Deserialize)]
struct CreditedArtist {
    id: String,
}

#[derive(Deserialize)]
struct Release {
    id: String,
}

pub fn parse_musicbrainz(json: &str) -> Result<Vec<Found>> {
    let search: Search = serde_json::from_str(json).context("reading a MusicBrainz search")?;
    Ok(search
        .recordings
        .into_iter()
        .map(|recording| Found {
            artist_mbid: recording.artist_credit.first().and_then(|credit| credit.artist.as_ref()).map(|artist| artist.id.clone()),
            release_mbid: recording.releases.first().map(|release| release.id.clone()),
            credited: recording.artist_credit.iter().map(|credit| credit.name.clone()).collect(),
            artist_credit: recording.artist_credit.iter().fold(String::new(), |mut credit_line, credit| {
                credit_line.push_str(&credit.name);
                credit_line.push_str(credit.joinphrase.as_deref().unwrap_or(""));
                credit_line
            }),
            recording_mbid: recording.id,
            title: recording.title,
            score: recording.score,
        })
        .collect())
}

fn escape(text: &str) -> String {
    text.replace('\\', "\\\\").replace('"', "\\\"")
}

/// The title up to a " - " or a " (": Spotify writes "Song - Cap.1" where MusicBrainz has "Song (Cap.1)",
/// and a phrase search for either spelling finds neither. `accept` still compares the whole title.
fn search_title(track: &str) -> &str {
    let cut = [" - ", " ("].iter().filter_map(|delimiter| track.find(delimiter)).min();
    cut.map_or(track, |at| track[..at].trim()).trim()
}

pub fn musicbrainz_query(pair: &Pair) -> String {
    let title = Some(search_title(&pair.track)).filter(|title| !title.is_empty()).unwrap_or(&pair.track);
    format!("recording:\"{}\" AND artist:\"{}\"", escape(title), escape(&pair.artist))
}

/// A looser second search for a pair the first did not place: the title cut at the first bracket or guest, and only
/// the lead artist of a collaboration. `accept` still compares the whole title and the credited names. None when
/// it would ask the same thing.
pub fn relaxed_query(pair: &Pair) -> Option<String> {
    let title = Some(crate::names::core_title(&pair.track)).filter(|title| !title.is_empty()).unwrap_or(&pair.track);
    let artist = crate::names::lead(&pair.artist);
    let query = format!("recording:\"{}\" AND artist:\"{}\"", escape(title), escape(artist));
    (query != musicbrainz_query(pair)).then_some(query)
}

fn search_musicbrainz(client: &reqwest::blocking::Client, pair: &Pair) -> Result<Vec<Found>> {
    let found = ask_musicbrainz(client, &musicbrainz_query(pair))?;
    if choose(pair, &found).0 == Outcome::Matched {
        return Ok(found);
    }
    let Some(query) = relaxed_query(pair) else { return Ok(found) };
    Ok(found.into_iter().chain(ask_musicbrainz(client, &query)?).collect())
}

fn ask_musicbrainz(client: &reqwest::blocking::Client, query: &str) -> Result<Vec<Found>> {
    for attempt in 1..=MUSICBRAINZ_ATTEMPTS {
        std::thread::sleep(MUSICBRAINZ_PAUSE);
        let response = client
            .get("https://musicbrainz.org/ws/2/recording")
            .query(&[("query", query), ("fmt", "json"), ("limit", CANDIDATES_PER_SEARCH)])
            .send()
            .context("asking MusicBrainz")?;
        // 429 and 5xx are MusicBrainz being busy or briefly broken; anything else that is not a success is a real error.
        if crate::musicbrainz_extra::is_transient(response.status()) && attempt < MUSICBRAINZ_ATTEMPTS {
            std::thread::sleep(MUSICBRAINZ_RETRY_PAUSE);
            continue;
        }
        if !response.status().is_success() {
            bail!("MusicBrainz answered {}", response.status());
        }
        return parse_musicbrainz(&response.text().context("reading the MusicBrainz answer")?);
    }
    bail!("MusicBrainz kept asking to slow down")
}

/// The `resolve-musicbrainz` job: at most `limit` pairs, one request a second.
pub fn resolve_musicbrainz(db: &SqliteClient, limit: usize) -> Result<()> {
    const SOURCE: &str = "musicbrainz";
    let pairs = pending_pairs(db, SOURCE, limit)?;
    let plays: i64 = pairs.iter().map(|pair| pair.plays).sum();
    println!("{} pairs to look up, {plays} plays (about {} s at one request a second)", pairs.len(), pairs.len());
    let client = crate::listenbrainz::http_client()?;
    let summary = resolve_with(db, SOURCE, &pairs, |pair| search_musicbrainz(&client, pair))?;
    db.execute(SQL_RESET_ENRICH_CURSOR, &[])?;
    println!("matched {} pairs ({} listens), {} rejected, {} not found", summary.matched, summary.listens_updated, summary.rejected, summary.missing);
    println!("next: enrich, then daily-plays all, all-time-totals, summaries all, facts all, memories, capsules, entities");
    Ok(())
}

/// Last.fm allows about five requests a second; a pair a quarter of a second keeps well under it.
const LASTFM_PAUSE: Duration = Duration::from_millis(250);
const LASTFM_RETRIES: u32 = 8;
const LASTFM_RETRY_PAUSE: Duration = Duration::from_secs(10);

fn ask_lastfm(client: &reqwest::blocking::Client, key: &str, pair: &Pair) -> Result<Vec<Found>> {
    for attempt in 1..=LASTFM_RETRIES {
        std::thread::sleep(LASTFM_PAUSE);
        let text = client
            .get("https://ws.audioscrobbler.com/2.0/")
            .query(&[("method", "track.getinfo"), ("artist", pair.artist.as_str()), ("track", pair.track.as_str()), ("autocorrect", "1"), ("api_key", key), ("format", "json")])
            .send()
            .and_then(reqwest::blocking::Response::text)
            .map_err(reqwest::Error::without_url)
            .context("asking Last.fm")?;
        match crate::lastfm::parse_track_info(&text) {
            Ok(found) => return Ok(found.into_iter().collect()),
            Err(_) if attempt < LASTFM_RETRIES && crate::lastfm::is_transient(&text) => {
                std::thread::sleep(LASTFM_RETRY_PAUSE);
            }
            Err(error) => return Err(error),
        }
    }
    bail!("Last.fm kept asking to slow down")
}

/// The `resolve-lastfm` job: at most `limit` pairs, whatever MusicBrainz' own search could not place.
/// Last.fm corrects the spelling of a track and often knows the recording id of one MusicBrainz' search missed.
pub fn resolve_lastfm(db: &SqliteClient, limit: usize) -> Result<()> {
    const SOURCE: &str = "lastfm";
    let key = std::env::var("LASTFM_API_KEY").context("LASTFM_API_KEY is not set")?;
    let pairs = pending_pairs(db, SOURCE, limit)?;
    let plays: i64 = pairs.iter().map(|pair| pair.plays).sum();
    println!("{} pairs to look up, {plays} plays", pairs.len());
    let client = crate::listenbrainz::http_client()?;
    let summary = resolve_with(db, SOURCE, &pairs, |pair| ask_lastfm(&client, &key, pair))?;
    db.execute(SQL_RESET_ENRICH_CURSOR, &[])?;
    println!("matched {} pairs ({} listens), {} rejected, {} not found", summary.matched, summary.listens_updated, summary.rejected, summary.missing);
    println!("next: enrich, then daily-plays all, all-time-totals, summaries all, facts all, memories, capsules, entities");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use shared_data::sqlite_client::SqliteClient;
    use std::path::Path;

    fn database() -> SqliteClient {
        let db = SqliteClient::open(Path::new(":memory:")).unwrap();
        crate::schema::apply(&db).unwrap();
        db
    }

    fn listen(db: &SqliteClient, at: i64, track: &str, artist: &str, mbid: Option<&str>) {
        db.execute(
            "INSERT INTO listens (listened_at, track_name, artist_name, recording_mbid) VALUES (?, ?, ?, ?)",
            &[json!(at), json!(track), json!(artist), json!(mbid)],
        )
        .unwrap();
    }

    fn pair(artist: &str, track: &str) -> Pair {
        Pair { artist: artist.into(), track: track.into(), plays: 1 }
    }

    fn found(title: &str, credit: &str, score: i64) -> Found {
        Found { recording_mbid: "rec".into(), artist_mbid: Some("art".into()), release_mbid: Some("rel".into()), title: title.into(), artist_credit: credit.into(), credited: Vec::new(), score }
    }

    #[test]
    fn pending_pairs_are_unmapped_most_played_first_and_skip_the_mapped() {
        let db = database();
        listen(&db, 1, "Rare", "Band", None);
        for at in 2..=4 {
            listen(&db, at, "Hit", "Band", None);
        }
        listen(&db, 5, "Mapped", "Band", Some("m"));

        let pairs = pending_pairs(&db, "musicbrainz", 10).unwrap();

        assert_eq!(pairs.iter().map(|p| (p.track.as_str(), p.plays)).collect::<Vec<_>>(), vec![("Hit", 3), ("Rare", 1)]);
    }

    #[test]
    fn a_pair_already_tried_is_pending_only_for_the_other_source() {
        let db = database();
        listen(&db, 1, "Song", "Band", None);
        record(&db, &pair("Band", "Song"), "musicbrainz", Outcome::Missing).unwrap();

        assert!(pending_pairs(&db, "musicbrainz", 10).unwrap().is_empty());
        assert_eq!(pending_pairs(&db, "listenbrainz", 10).unwrap().len(), 1);
    }

    #[test]
    fn the_limit_caps_the_pairs() {
        let db = database();
        for at in 0..5 {
            listen(&db, at, &format!("Song {at}"), "Band", None);
        }

        assert_eq!(pending_pairs(&db, "musicbrainz", 2).unwrap().len(), 2);
    }

    #[test]
    fn apply_updates_every_unmapped_listen_of_the_pair_and_nothing_else() {
        let db = database();
        listen(&db, 1, "Song", "Band", None);
        listen(&db, 2, "Song", "Band", None);
        listen(&db, 3, "Song", "Band", Some("already"));
        listen(&db, 4, "Other", "Band", None);

        let updated = apply(&db, &pair("Band", "Song"), &found("Song", "Band", 100)).unwrap();

        assert_eq!(updated, 2);
        let rows = db.query("SELECT listened_at, recording_mbid, artist_mbid, release_mbid FROM listens ORDER BY listened_at", &[]).unwrap();
        assert_eq!(rows[0]["recording_mbid"], "rec");
        assert_eq!((rows[0]["artist_mbid"].as_str(), rows[0]["release_mbid"].as_str()), (Some("art"), Some("rel")));
        assert_eq!(rows[2]["recording_mbid"], "already");
        assert!(rows[3]["recording_mbid"].is_null());
    }

    #[test]
    fn accept_needs_the_artist_and_the_title_to_agree() {
        let wanted = pair("ROSALÍA", "Despechá");
        assert!(accept(&wanted, &found("Despechá", "Rosalia", 100)));
        assert!(!accept(&wanted, &found("Despechá - Remix", "Rosalia", 100)));
        assert!(!accept(&wanted, &found("Despechá", "Someone Else", 100)));
    }

    #[test]
    fn choose_takes_the_first_acceptable_candidate_and_says_why_it_took_none() {
        let wanted = pair("Band", "Song");
        let wrong = found("Song - Live", "Band", 100);
        let right = found("Song", "Band", 98);

        let both = [wrong.clone(), right.clone()];
        let (outcome, chosen) = choose(&wanted, &both);
        assert_eq!((outcome, chosen.map(|f| f.score)), (Outcome::Matched, Some(98)));

        assert_eq!(choose(&wanted, &[wrong]).0, Outcome::Rejected);
        assert_eq!(choose(&wanted, &[]).0, Outcome::Missing);
    }

    #[test]
    fn an_exact_name_match_a_feat_credit_scored_in_the_eighties_is_taken() {
        let candidates = [found("Cry (Commentary)", "Ashnikko", 100), found("Cry", "Ashnikko feat. Grimes", 86)];
        let (outcome, chosen) = choose(&pair("Ashnikko", "Cry"), &candidates);
        assert_eq!((outcome, chosen.map(|f| f.score)), (Outcome::Matched, Some(86)));
    }

    #[test]
    fn a_low_score_candidate_is_not_taken_even_when_the_names_agree() {
        let (outcome, _) = choose(&pair("Band", "Song"), &[found("Song", "Band", MIN_SCORE - 1)]);

        assert_eq!(outcome, Outcome::Rejected);
    }

    #[test]
    fn parse_musicbrainz_reads_the_real_shape() {
        let answer = json!({
            "recordings": [{
                "id": "rec-1", "title": "Song", "score": 100,
                "artist-credit": [{ "name": "Band", "joinphrase": " & ", "artist": { "id": "art-1", "name": "Band" } }, { "name": "Guest", "artist": { "id": "art-2", "name": "Guest" } }],
                "releases": [{ "id": "rel-1", "title": "Album" }]
            }, { "id": "rec-2", "title": "Bare", "score": 80 }]
        });

        let parsed = parse_musicbrainz(&answer.to_string()).unwrap();

        assert_eq!(parsed.len(), 2);
        assert_eq!((parsed[0].recording_mbid.as_str(), parsed[0].artist_credit.as_str(), parsed[0].score), ("rec-1", "Band & Guest", 100));
        assert_eq!((parsed[0].artist_mbid.as_deref(), parsed[0].release_mbid.as_deref()), (Some("art-1"), Some("rel-1")));
        assert_eq!((parsed[1].artist_mbid.as_deref(), parsed[1].release_mbid.as_deref()), (None, None));
    }

    #[test]
    fn a_collaboration_matches_when_the_listened_artist_is_one_of_the_credited() {
        let wanted = pair("ROSALÍA", "Con Altura");
        let collaboration = Found { credited: vec!["J Balvin".into(), "ROSALÍA".into()], ..found("Con Altura", "J Balvin & ROSALÍA feat. El Guincho", 100) };

        assert!(accept(&wanted, &collaboration));
        assert!(!accept(&pair("Someone Else", "Con Altura"), &collaboration));
    }

    #[test]
    fn the_search_uses_the_title_before_a_dash_or_a_bracket_and_the_match_still_uses_all_of_it() {
        let spotify = pair("ROSALÍA", "MALAMENTE - Cap.1: Augurio");
        assert_eq!(musicbrainz_query(&spotify), r#"recording:"MALAMENTE" AND artist:"ROSALÍA""#);
        assert_eq!(musicbrainz_query(&pair("Band", "Song (feat. Guest)")), r#"recording:"Song" AND artist:"Band""#);
        assert!(accept(&spotify, &found("MALAMENTE (Cap.1: Augurio)", "ROSALÍA", 100)));
        assert!(!accept(&spotify, &found("MALAMENTE", "ROSALÍA", 100)));
    }

    #[test]
    fn the_relaxed_query_cuts_the_guest_and_keeps_the_lead_artist() {
        let pair = Pair { artist: "Beyoncé feat. JAŸ-Z".into(), track: "Top Off [Clean] feat. Future".into(), plays: 1 };
        assert_eq!(relaxed_query(&pair), Some("recording:\"Top Off\" AND artist:\"Beyoncé\"".to_string()));
    }

    #[test]
    fn the_relaxed_query_is_none_when_it_would_ask_the_same_thing() {
        assert_eq!(relaxed_query(&Pair { artist: "Madonna".into(), track: "Vogue".into(), plays: 1 }), None);
    }

    #[test]
    fn the_search_query_escapes_quotes_and_backslashes() {
        assert_eq!(musicbrainz_query(&pair("Band \"X\"", "Song\\1")), r#"recording:"Song\\1" AND artist:"Band \"X\"""#);
    }

    #[test]
    fn resolve_with_applies_matches_and_remembers_the_rest_so_a_second_run_has_nothing_to_do() {
        let db = database();
        listen(&db, 1, "Song", "Band", None);
        listen(&db, 2, "Cover", "Band", None);
        listen(&db, 3, "Unknown", "Nobody", None);
        let pairs = pending_pairs(&db, "musicbrainz", 10).unwrap();

        let summary = resolve_with(&db, "musicbrainz", &pairs, |pair| {
            Ok(match pair.track.as_str() {
                "Song" => vec![found("Song", "Band", 100)],
                "Cover" => vec![found("Cover - Live", "Band", 100)],
                _ => vec![],
            })
        })
        .unwrap();

        assert_eq!(summary, Summary { matched: 1, rejected: 1, missing: 1, listens_updated: 1 });
        assert!(pending_pairs(&db, "musicbrainz", 10).unwrap().is_empty());
        assert_eq!(db.query("SELECT COUNT(*) AS n FROM listens WHERE recording_mbid IS NOT NULL", &[]).unwrap()[0]["n"], 1);
    }

}
