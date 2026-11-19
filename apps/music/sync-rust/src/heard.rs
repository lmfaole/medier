//! What the owner has heard that is no scrobble (`music_heard`): `add-heard` adds an artist, an album or a song, and
//! `enrich-heard` asks MusicBrainz for what each row lacks: its number, its first release year and up to three genres
//! (the tags that are official genres). The answers are landed unchanged under `.data/raw/musicbrainz/<date>/`. A row
//! that MusicBrainz does not know keeps what it was given and is not asked about again.

use std::time::Duration;

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use shared_data::sqlite_client::SqliteClient;
use shared_data::text::slug;

const API: &str = "https://musicbrainz.org/ws/2";
const PAUSE: Duration = Duration::from_millis(1100);
const RETRY_AFTER: Duration = Duration::from_secs(5);
const TRIES: u32 = 3;
const GENRES_KEPT: usize = 3;
const INSERT: &str = "INSERT OR IGNORE INTO music_heard (kind, artist, title, year, heard_on) VALUES (?, ?, ?, ?, ?)";
const PENDING: &str = "SELECT id, kind, artist, title, year FROM music_heard WHERE looked_up_at IS NULL ORDER BY id";
const SET: &str = "UPDATE music_heard SET mbid = ?, year = COALESCE(year, ?), genres = ?, looked_up_at = ? WHERE id = ?";

/// The kind a word names, or an error that lists them.
pub fn kind_of(word: &str) -> Result<&'static str> {
    match word {
        "artist" => Ok("artist"),
        "album" => Ok("album"),
        "song" => Ok("song"),
        other => bail!("«{other}» is not artist, album or song"),
    }
}

/// `add-heard <kind> <artist> <title> [year] [day]`: `-` for none, an empty title for an artist. Returns whether it was new.
pub fn add(db: &SqliteClient, kind: &str, artist: &str, title: &str, year: Option<i64>, day: Option<&str>) -> Result<bool> {
    let kind = kind_of(kind)?;
    if artist.trim().is_empty() || (kind != "artist" && title.trim().is_empty()) {
        bail!("an {kind} needs {}", if kind == "artist" { "an artist" } else { "an artist and a title" });
    }
    let before = db.query("SELECT count(*) AS n FROM music_heard", &[])?.first().and_then(|row| row["n"].as_i64()).unwrap_or(0);
    db.execute_batch(&[(INSERT.to_string(), vec![json!(kind), json!(artist.trim()), json!(if kind == "artist" { "" } else { title.trim() }), json!(year), json!(day)])]).context("adding what was heard")?;
    let after = db.query("SELECT count(*) AS n FROM music_heard", &[])?.first().and_then(|row| row["n"].as_i64()).unwrap_or(0);
    Ok(after > before)
}

/// The first year of a MusicBrainz date (`1997-05-21`, `1997`), or none.
#[must_use]
pub fn year_of(date: &str) -> Option<i64> {
    date.get(..4)?.parse().ok()
}

/// The best-counted tags that are official genres, up to `GENRES_KEPT`, most counted first and a tie by name.
#[must_use]
pub fn genres_in(entity: &Value) -> Vec<String> {
    let mut genres: Vec<(i64, String)> = entity["genres"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|genre| Some((genre["count"].as_i64().unwrap_or(0), genre["name"].as_str()?.to_string())))
        .collect();
    genres.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    genres.into_iter().take(GENRES_KEPT).map(|(_, name)| name).collect()
}

/// The first search hit whose name is the one asked for (ignoring case), else the first hit.
#[must_use]
pub fn best_hit<'a>(hits: &'a [Value], name_field: &str, wanted: &str) -> Option<&'a Value> {
    hits.iter().find(|hit| hit[name_field].as_str().is_some_and(|name| name.eq_ignore_ascii_case(wanted))).or_else(|| hits.first())
}

/// MusicBrainz answers 503 now and then, when it is busy or when a second is not between two asks; it is asked again a few
/// seconds later, up to three times.
fn get(http: &reqwest::blocking::Client, path: &str, query: &[(&str, &str)]) -> Result<Value> {
    for attempt in 1..=TRIES {
        std::thread::sleep(PAUSE);
        let response = http.get(format!("{API}{path}")).query(query).query(&[("fmt", "json")]).send().with_context(|| format!("asking MusicBrainz for {path}"))?;
        if response.status() == reqwest::StatusCode::SERVICE_UNAVAILABLE && attempt < TRIES {
            std::thread::sleep(RETRY_AFTER);
            continue;
        }
        return response.error_for_status().with_context(|| format!("asking MusicBrainz for {path}"))?.json().context("reading MusicBrainz's answer");
    }
    bail!("MusicBrainz did not answer {path}")
}

/// What MusicBrainz says about one row: its number, its first release year and its genres.
type Found = (String, Option<i64>, Vec<String>);

fn look_up(http: &reqwest::blocking::Client, directory: &std::path::Path, kind: &str, artist: &str, title: &str) -> Result<Option<Found>> {
    let (entity, query, field, name_field, date_field) = match kind {
        "artist" => ("artist", format!("artist:\"{artist}\""), "artists", "name", "life-span"),
        "album" => ("release-group", format!("releasegroup:\"{title}\" AND artist:\"{artist}\""), "release-groups", "title", "first-release-date"),
        _ => ("recording", format!("recording:\"{title}\" AND artist:\"{artist}\""), "recordings", "title", "first-release-date"),
    };
    let search = get(http, &format!("/{entity}"), &[("query", query.as_str()), ("limit", "5")])?;
    shared_data::tmdb::land(&directory.join(format!("search-{kind}-{}.json", slug(&format!("{artist} {title}")))), &search)?;
    let hits = search[field].as_array().cloned().unwrap_or_default();
    let Some(hit) = best_hit(&hits, name_field, if kind == "artist" { artist } else { title }) else { return Ok(None) };
    let Some(id) = hit["id"].as_str() else { return Ok(None) };
    let full = get(http, &format!("/{entity}/{id}"), &[("inc", "genres")])?;
    shared_data::tmdb::land(&directory.join(format!("{entity}-{id}.json")), &full)?;
    let year = if kind == "artist" { full[date_field]["begin"].as_str().and_then(year_of) } else { full[date_field].as_str().and_then(year_of) };
    Ok(Some((id.to_string(), if kind == "artist" { None } else { year }, genres_in(&full))))
}

/// `enrich-heard`: asks MusicBrainz about every row it has not been asked about; returns how many it found.
pub fn enrich(db: &SqliteClient) -> Result<usize> {
    let rows = db.query(PENDING, &[])?;
    if rows.is_empty() {
        return Ok(0);
    }
    let http = shared_data::http::client("music-sync/0.1 (+https://sky.lmfaole.party/apps/medier/musikk)")?;
    let directory = shared_data::raw::landing_path("musicbrainz", chrono::Utc::now().date_naive())?;
    std::fs::create_dir_all(&directory).with_context(|| format!("creating {}", directory.display()))?;
    let now = chrono::Utc::now().timestamp();
    let mut found = 0;
    for row in &rows {
        let (Some(id), Some(kind), Some(artist)) = (row["id"].as_i64(), row["kind"].as_str(), row["artist"].as_str()) else { continue };
        let title = row["title"].as_str().unwrap_or_default();
        match look_up(&http, &directory, kind, artist, title) {
            Ok(Some((mbid, year, genres))) => {
                db.execute_batch(&[(SET.to_string(), vec![json!(mbid), json!(year), json!(json!(genres).to_string()), json!(now), json!(id)])])?;
                found += 1;
            }
            Ok(None) => db.execute_batch(&[(SET.to_string(), vec![Value::Null, Value::Null, json!("[]"), json!(now), json!(id)])])?,
            Err(error) => eprintln!("heard: {artist} {title} skipped: {error:#}"),
        }
    }
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_date_gives_its_year_and_the_best_counted_genres_come_first() {
        assert_eq!(year_of("1997-05-21"), Some(1997));
        assert_eq!(year_of("97"), None);
        let entity = json!({"genres": [{"name": "trip hop", "count": 3}, {"name": "electronic", "count": 9}, {"name": "ambient", "count": 3}, {"name": "pop", "count": 1}]});
        assert_eq!(genres_in(&entity), vec!["electronic", "ambient", "trip hop"]);
    }

    #[test]
    fn the_hit_is_the_one_with_the_name_asked_for_else_the_first() {
        let hits = vec![json!({"id": "a", "title": "Other"}), json!({"id": "b", "title": "OK Computer"})];
        assert_eq!(best_hit(&hits, "title", "ok computer").and_then(|hit| hit["id"].as_str()), Some("b"));
        assert_eq!(best_hit(&hits, "title", "Unknown").and_then(|hit| hit["id"].as_str()), Some("a"));
    }

    #[test]
    fn what_was_heard_is_added_once_and_a_kind_has_to_be_one_of_three() {
        let db = shared_data::app_db::memory_with_schema(include_str!("../../../../db/music.sql"));
        assert!(add(&db, "album", "Radiohead", "OK Computer", Some(1997), None).unwrap_or(false));
        assert!(!add(&db, "album", "Radiohead", "OK Computer", None, Some("2020-01-01")).unwrap_or(true));
        assert!(add(&db, "artist", "Björk", "ignored", None, None).unwrap_or(false));
        assert!(add(&db, "album", "Radiohead", "", None, None).is_err());
        assert!(kind_of("film").is_err());
    }
}
